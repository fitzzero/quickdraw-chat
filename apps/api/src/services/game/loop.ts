/**
 * GameLoop — drives the simulation at a fixed tick rate and fans results out.
 *
 * The loop knows nothing about sockets or Prisma: it takes emit/persist
 * callbacks so tests can drive `tickOnce()` manually and assert on the
 * results without timers or I/O.
 */

import type { GameDeathEvent, LeaderboardEntry, WorldSnapshot } from "@project/shared";
import { GAME_TICK_RATE } from "@project/shared";
import type { GameWorldSim, TickResult } from "./world.js";

/** What the loop sends, by kind; the runtime puts each on the wire. */
export interface GameLoopEmits {
  /** Every tick, volatile: droppable under backpressure (the world stream). */
  snapshot: (snapshot: WorldSnapshot) => void;
  /** Reliable: a snake died (the world's room). */
  death: (death: GameDeathEvent) => void;
  /** Reliable, 1Hz: the longest snakes (the world's room). */
  leaderboard: (entries: LeaderboardEntry[]) => void;
}

export interface GameLoopDeps {
  sim: GameWorldSim;
  emit: GameLoopEmits;
  /** Off-tick-path persistence hook (score upserts). Must not throw. */
  onDeath?: (death: GameDeathEvent) => void;
  /**
   * Is anyone watching (sockets in the world's room, spectators included)?
   * Keeps the NPC world alive behind the pre-game dialog. Omitted = false.
   */
  hasAudience?: () => boolean;
  /**
   * Bench/observability hook — called after every tick with the result and
   * timing stats. Stats are only measured when the hook is present, so
   * production (which never passes it) pays nothing.
   */
  onTick?: (result: TickResult, stats: TickStats) => void;
}

export interface TickStats {
  tick: number;
  /** epoch ms with sub-ms precision (performance.timeOrigin + now) */
  tWall: number;
  tickDurMs: number;
  snapshotBytes: number;
}

const LEADERBOARD_INTERVAL_MS = 1000;

export class GameLoop {
  private readonly deps: GameLoopDeps;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private leaderboardTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: GameLoopDeps) {
    this.deps = deps;
  }

  public start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tickOnce(), 1000 / GAME_TICK_RATE);
    this.leaderboardTimer = setInterval(() => this.emitLeaderboard(), LEADERBOARD_INTERVAL_MS);
    // Timers must not keep a draining process alive
    this.tickTimer.unref?.();
    this.leaderboardTimer.unref?.();
  }

  public stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.leaderboardTimer) clearInterval(this.leaderboardTimer);
    this.tickTimer = null;
    this.leaderboardTimer = null;
  }

  /**
   * Run exactly one simulation tick and broadcast the results.
   * Public so integration tests can drive the world without timers.
   */
  public tickOnce(): TickResult | null {
    if (this.isIdle()) return null;

    const t0 = this.deps.onTick ? performance.now() : 0;
    const result = this.deps.sim.step();
    const tickDurMs = this.deps.onTick ? performance.now() - t0 : 0;
    // Send-time stamp for client clock sync (H2); the sim itself stays
    // wall-clock-free — timing belongs to the transport boundary.
    result.snapshot.t = Math.round(performance.timeOrigin + performance.now());
    this.deps.emit.snapshot(result.snapshot);

    for (const death of result.deaths) {
      this.deps.emit.death(death);
      this.deps.onDeath?.(death);
    }

    this.deps.onTick?.(result, {
      tick: result.snapshot.tick,
      tWall: performance.timeOrigin + performance.now(),
      tickDurMs,
      snapshotBytes: JSON.stringify(result.snapshot).length,
    });

    return result;
  }

  public emitLeaderboard(): void {
    if (this.isIdle()) return;
    this.deps.emit.leaderboard(this.deps.sim.leaderboard());
  }

  /** Freeze the sim (NPCs included) only when nobody plays AND nobody watches. */
  private isIdle(): boolean {
    return this.deps.sim.humanCount() === 0 && !this.deps.hasAudience?.();
  }
}
