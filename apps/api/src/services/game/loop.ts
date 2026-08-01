/**
 * GameLoop — drives the simulation at a fixed tick rate and fans results out.
 *
 * The loop knows nothing about sockets or Prisma: it takes emit/persist
 * callbacks so tests can drive `tickOnce()` manually and assert on the
 * results without timers or I/O.
 */

import type { GameDeathEvent } from "@project/shared";
import { GAME_EVENTS, GAME_TICK_RATE } from "@project/shared";
import type { GameWorldSim, TickResult } from "./world.js";

export interface GameLoopDeps {
  sim: GameWorldSim;
  /** Volatile room broadcast (snapshots — droppable under backpressure). */
  emitVolatile: (eventName: string, data: unknown) => void;
  /** Reliable room broadcast (deaths, leaderboard). */
  emitReliable: (eventName: string, data: unknown) => void;
  /** Off-tick-path persistence hook (score upserts). Must not throw. */
  onDeath?: (death: GameDeathEvent) => void;
  /**
   * Is anyone watching (world-room subscribers, spectators included)?
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
    this.deps.emitVolatile(GAME_EVENTS.snapshot, result.snapshot);

    for (const death of result.deaths) {
      this.deps.emitReliable(GAME_EVENTS.death, death);
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
    this.deps.emitReliable(GAME_EVENTS.leaderboard, this.deps.sim.leaderboard());
  }

  /** Freeze the sim (NPCs included) only when nobody plays AND nobody watches. */
  private isIdle(): boolean {
    return this.deps.sim.humanCount() === 0 && !this.deps.hasAudience?.();
  }
}
