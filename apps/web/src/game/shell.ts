/**
 * The web game client's shell: the shared GameClientCore (the netcode the
 * bench bots run too) driven by one requestAnimationFrame loop, with the
 * page's input and a renderer behind the GameRenderer boundary. Per display
 * frame: the core steps the local predictor on its own 20 Hz accumulator
 * (sending each step's input), advances the clocks and renders every remote
 * at the render tick; the shell points the camera (the local head, or the
 * spectate target) and hands the frame to the renderer. No fixed-rate
 * physics timer anywhere: the local snake moves at the display's rate.
 */

import type {
  GameClientInput,
  GamePlayerMeta,
  GameTransport,
  GameTunables,
  RemotesMode,
  RenderedWorld,
} from "@project/shared";
import { GAME_TICK_RATE, GameClientCore } from "@project/shared";
import type { BenchTelemetry } from "./bench";
import { PointerInput } from "./input";
import type { GameProbe } from "./probe";
import type { GameRenderer, RenderBackend, RendererStats } from "./render/renderer";
import { SpectateCamera } from "./render/spectate";
import type { GameLoadState } from "./types";

/** How often the renderer's stats are read (the debug overlay, the bench). */
const STATS_EVERY_MS = 500;
/** The longest a frame counts as (a hitch, a background tab), as the bots cap it. */
const MAX_FRAME_S = 0.25;

export interface GameShellOptions {
  canvas: HTMLCanvasElement;
  transport: GameTransport;
  renderer: GameRenderer;
  /** The user whose snake is the local one; null spectates. */
  userId: string | null;
  tunables: GameTunables;
  /** The players known at the start (the bootstrap's); the transport adds the rest. */
  players: Iterable<GamePlayerMeta>;
  preference?: RenderBackend;
  /** Where the remotes render (`?remotes=`); the core's default when unset. */
  remotes?: RemotesMode;
  /** Bench mode's telemetry sink. */
  telemetry?: BenchTelemetry;
  /** Bench mode: respawn this many ms after the local snake's death (no dialog). */
  autoRespawnMs?: number;
  /** check:web's probe (`?probe=1`): records what the client sees, steers the local snake. */
  probe?: GameProbe;
  onState: (state: GameLoadState) => void;
  /** The renderer's stats, the frame rate and the newest tick, every half second (the debug overlay). */
  onStats?: (stats: GameStats) => void;
}

/**
 * What the debug overlay and the bench read every half second: the
 * renderer's stats, the frame rate, the newest snapshot's tick, and the
 * main thread's work per frame (the core's step, the draw and the engine's
 * render: everything the frame callback does), as the p99 and the mean of
 * the last half second. The work, not the frame gap, says how much headroom
 * the loop has: a display's refresh rate caps the gap wherever the loop
 * runs, and 8 ms of work a frame is what 144 Hz allows.
 */
export interface GameStats extends RendererStats {
  fps: number;
  tick: number;
  frameWorkMs: { p99: number; mean: number };
}

function now(): number {
  return performance.timeOrigin + performance.now();
}

/** The step's input toward a world point from the head; the current heading once there. */
function steerToward(
  at: { x: number; y: number },
  target: { x: number; y: number },
  heading: { x: number; y: number },
): GameClientInput {
  const dx = target.x - at.x;
  const dy = target.y - at.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { dx: heading.x, dy: heading.y, boost: false };
  return { dx: dx / distance, dy: dy / distance, boost: false };
}

/** The p99 and the mean of a window of frame times (zeros for an empty one). */
function summarize(samples: readonly number[]): { p99: number; mean: number } {
  if (samples.length === 0) return { p99: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  return { p99, mean };
}

export class GameShell {
  private readonly core: GameClientCore;
  private readonly spectate = new SpectateCamera();
  private readonly players = new Map<string, GamePlayerMeta>();
  private input: PointerInput | null = null;
  private raf = 0;
  private lastFrameAt = 0;
  private startedAt = 0;
  private lastStatsAt = 0;
  private framesSinceStats = 0;
  private readonly workMs: number[] = [];
  private stopped = false;
  private ready = false;
  private snapCamera = true;

  constructor(private readonly opts: GameShellOptions) {
    for (const meta of opts.players) this.players.set(meta.id, meta);
    const { telemetry, userId } = opts;
    this.core = new GameClientCore({
      transport: opts.transport,
      userId: userId ?? "",
      tunables: opts.tunables,
      tickRate: GAME_TICK_RATE,
      now,
      remotes: opts.remotes,
      hooks: {
        onSnapshotArrival: (tWall, tick) => telemetry?.snapshot(tWall, tick),
        onInputSent: (frames, tSent) => telemetry?.input(frames.at(-1)?.seq ?? -1, tSent),
        onCorrection: (correction, ack, tWall) => {
          telemetry?.correction(tWall, correction.magnitudePx, correction.hard, ack);
          // a hard snap teleported the head: its body history starts over
          if (correction.hard && userId !== null) opts.renderer.resetPath(userId);
        },
        onLeft: (id) => {
          this.players.delete(id);
          opts.probe?.left(id);
        },
        onSpawn: () => {
          // open on the snake, wherever the spectate camera was
          this.snapCamera = true;
        },
        onDeath: (death) => {
          opts.probe?.death(death);
          if (death.id !== userId || opts.autoRespawnMs === undefined) return;
          setTimeout(() => {
            if (!this.stopped) this.core.respawn();
          }, opts.autoRespawnMs);
        },
      },
    });
  }

  /** A player's name and hue, from a playerJoined event. */
  public addPlayer(meta: GamePlayerMeta): void {
    this.addPlayers([meta]);
  }

  /**
   * The players a join answered: the first one's, and every later one's
   * (a reconnect; after a server restart a new world draws new hues, and
   * the packed snapshots name players by id alone).
   */
  public addPlayers(metas: Iterable<GamePlayerMeta>): void {
    const list = [...metas];
    for (const meta of list) this.players.set(meta.id, meta);
    this.opts.renderer.setPlayers(list);
  }

  public async start(): Promise<void> {
    const { renderer, canvas, onState } = this.opts;
    onState({ phase: "loading", progress: null });
    await renderer.mount(canvas, {
      ...(this.opts.preference === undefined ? {} : { preference: this.opts.preference }),
    });
    if (this.stopped) return;
    renderer.setPlayers(this.players.values());
    onState({ phase: "connecting" });
    // A signed-out visitor spectates; a player's snake is placed by the
    // first own snapshot (the page's joinGame spawns it)
    const joined = await this.core.start(this.opts.userId === null);
    if (this.stopped) return;
    renderer.setBounds(joined.bounds.w, joined.bounds.h);
    this.spectate.setBounds(joined.bounds.w, joined.bounds.h);
    this.spectate.snap();
    this.input = new PointerInput(canvas, (x, y) => renderer.worldPointAt(x, y));
    this.startedAt = now();
    this.lastFrameAt = performance.now();
    this.lastStatsAt = this.lastFrameAt;
    this.raf = requestAnimationFrame(this.frame);
  }

  public stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.input?.destroy();
    this.input = null;
    this.core.stop();
    this.opts.telemetry?.destroy();
    this.opts.renderer.destroy();
  }

  private readonly frame = (tNow: number): void => {
    if (this.stopped) return;
    const deltaS = Math.min((tNow - this.lastFrameAt) / 1000, MAX_FRAME_S);
    this.lastFrameAt = tNow;
    const tWall = performance.timeOrigin + tNow;

    const rendered = this.core.renderFrame(deltaS, this.sampleInput, tWall);
    this.draw(rendered, deltaS, tWall);
    this.workMs.push(performance.now() - tNow);
    this.record(rendered, tNow, tWall);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** One predicted step's input: toward the pointer (or the probe's target) from the head as drawn. */
  private readonly sampleInput = (): GameClientInput => {
    const predictor = this.core.localPredictor;
    if (this.input === null || predictor === null) return { dx: 1, dy: 0, boost: false };
    const target = this.opts.probe?.steerTarget ?? null;
    if (target !== null) return steerToward(predictor.getRenderedPos(), target, predictor.simDir);
    return this.input.sample(predictor.getRenderedPos(), {
      dx: predictor.simDir.x,
      dy: predictor.simDir.y,
    });
  };

  private draw(rendered: RenderedWorld, deltaS: number, tWall: number): void {
    const { renderer, userId, onState } = this.opts;
    let camera: { x: number; y: number };
    if (rendered.local === null) {
      // before the player joins and after a death, the camera drifts
      // toward the busiest part of the world
      this.spectate.retarget(rendered.remotes);
      this.spectate.advance(deltaS);
      camera = this.spectate.position;
    } else {
      camera = rendered.local;
    }
    if (!this.ready && this.core.latestTick > 0) {
      // the first snapshot: the world is here, open on the action
      this.ready = true;
      this.spectate.snap();
      this.snapCamera = true;
      onState({ phase: "ready" });
    }
    renderer.draw({
      local: rendered.local,
      localId: userId,
      remotes: rendered.remotes,
      food: rendered.food,
      camera,
      snapCamera: this.snapCamera,
      nowS: (tWall - this.startedAt) / 1000,
      deltaS,
    });
    this.snapCamera = false;
  }

  private record(rendered: RenderedWorld, tNow: number, tWall: number): void {
    const { telemetry, renderer, onStats, userId } = this.opts;
    telemetry?.frame(tWall, rendered, userId);
    this.framesSinceStats += 1;
    if (tNow - this.lastStatsAt >= STATS_EVERY_MS) {
      const stats = renderer.stats();
      const fps = (this.framesSinceStats * 1000) / (tNow - this.lastStatsAt);
      this.lastStatsAt = tNow;
      this.framesSinceStats = 0;
      const frameWorkMs = summarize(this.workMs);
      this.workMs.length = 0;
      telemetry?.rendererStats(tWall, { ...stats, frameWorkMs });
      onStats?.({ ...stats, fps, tick: this.core.latestTick, frameWorkMs });
      this.opts.probe?.seen(rendered, this.core.latestTick);
      this.opts.probe?.food(this.core.foodState());
    }
    telemetry?.flushIfDue(tWall);
  }
}
