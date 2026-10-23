/**
 * GameLoop — drives the simulation at a fixed tick rate and fans results out.
 *
 * The loop knows nothing about sockets or Prisma: it takes emit/persist
 * callbacks so tests can drive `tickOnce()` manually and assert on the
 * results without timers or I/O.
 */

import type {
  FoodDelta,
  GameDeathEvent,
  LeaderboardEntry,
  PackedWorldItem,
  WorldSnapshot,
} from "@project/shared";
import { GAME_FOOD_WINDOW, GAME_TICK_RATE } from "@project/shared";
import type { GameWorldSim, TickResult } from "./world.js";

/** What the loop sends, by kind; the runtime puts each on the wire. */
export interface GameLoopEmits {
  /**
   * Every tick, volatile: droppable under backpressure (the world stream).
   * Returns the stream item it sent, which `onTick` measures.
   */
  snapshot: (snapshot: WorldSnapshot) => PackedWorldItem;
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
  /** The stream item's JSON: the packed snapshot, base64, in `{ b }`. */
  snapshotBytes: number;
}

const LEADERBOARD_INTERVAL_MS = 1000;

export class GameLoop {
  private readonly deps: GameLoopDeps;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private leaderboardTimer: ReturnType<typeof setInterval> | null = null;
  /** When the next tick is due (performance.now() ms), on a fixed grid. */
  private nextTickAt = 0;
  private running = false;
  /** The food changes of the last GAME_FOOD_WINDOW ticks, oldest first: every snapshot repeats them. */
  private readonly foodWindow: FoodDelta[] = [];

  constructor(deps: GameLoopDeps) {
    this.deps = deps;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.nextTickAt = performance.now();
    this.scheduleTick();
    this.leaderboardTimer = setInterval(() => this.emitLeaderboard(), LEADERBOARD_INTERVAL_MS);
    // Timers must not keep a draining process alive
    this.leaderboardTimer.unref?.();
  }

  /**
   * Ticks on a fixed grid of GAME_TICK_RATE a second: each timeout aims at
   * the next grid point, so lateness does not add up (setInterval's does,
   * about 0.3% at 20 Hz, and a client stepping at the tick rate by its own
   * clock would run ahead of the world). The next tick is due before this
   * one runs; a loop that fell more than a tick behind starts the grid
   * again from now.
   */
  private scheduleTick(): void {
    if (!this.running) return;
    const period = 1000 / GAME_TICK_RATE;
    const now = performance.now();
    this.nextTickAt += period;
    if (this.nextTickAt < now - period) this.nextTickAt = now;
    this.tickTimer = setTimeout(
      () => {
        this.scheduleTick();
        this.tickOnce();
      },
      Math.max(0, this.nextTickAt - now),
    );
    this.tickTimer.unref?.();
  }

  public stop(): void {
    this.running = false;
    if (this.tickTimer) clearTimeout(this.tickTimer);
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
    // A volatile snapshot may be dropped: each carries the food changes of
    // the last ticks, so the next one makes up for it
    if (result.food) this.foodWindow.push(result.food);
    const since = result.snapshot.tick - GAME_FOOD_WINDOW;
    while ((this.foodWindow[0]?.tick ?? Infinity) <= since) this.foodWindow.shift();
    if (this.foodWindow.length > 0) result.snapshot.food = [...this.foodWindow];
    // Send-time stamp for client clock sync (H2); the sim itself stays
    // wall-clock-free — timing belongs to the transport boundary.
    result.snapshot.t = Math.round(performance.timeOrigin + performance.now());
    const item = this.deps.emit.snapshot(result.snapshot);

    for (const death of result.deaths) {
      this.deps.emit.death(death);
      this.deps.onDeath?.(death);
    }

    this.deps.onTick?.(result, {
      tick: result.snapshot.tick,
      tWall: performance.timeOrigin + performance.now(),
      tickDurMs,
      snapshotBytes: JSON.stringify(item).length,
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
