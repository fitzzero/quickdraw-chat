/**
 * BotClient — a headless stand-in for one real game client: the shared
 * GameClientCore (the same netcode the web page runs: LocalPredictor +
 * RemoteInterpolator, the world clock, the food) under a bot's shell, which
 * steers it with a behavior and records a ClientTrace for the metrics
 * pipeline. Its transport carries the wire: the production one, quickdraw
 * protocol v5 as the Godot client speaks it, through an optional latency
 * proxy (socket-transport.ts), or a loopback link to a party's host in
 * process (party-transport.ts).
 *
 * The render loop targets 60Hz like a browser; ACTUAL frame times are
 * recorded, so timer wobble shows up in the data instead of being assumed
 * away. The remote interpolator's per-frame nudge is frame-rate dependent —
 * effectiveFps in the scorecard guards against a bot loop that fell behind.
 */

import type { ClientTrace, Scenario } from "@project/bench";
import { deriveSeed, mulberry32 } from "@project/bench";
import type { Correction, GameDeathEvent, GameInput, GameTransport } from "@project/shared";
import { GameClientCore, type PredictionTunables } from "@project/shared";
import { makeBehavior, type BehaviorFn } from "./behaviors.js";

const RENDER_FRAME_MS = 1000 / 60;

export interface BotOptions {
  /** The wire: the server's socket, or a loopback link to a party's host. */
  transport: GameTransport;
  userId: string;
  name: string;
  behaviorKind: "wander" | "cross" | "orbit" | "spectator";
  /** optional oscillating render clock (BotSpec.render) */
  render?: { minFps: number; maxFps: number; periodS: number; phaseS?: number };
  /** the predictor's clock against wall time (BotSpec.clockScale); default 1 */
  clockScale?: number;
  scenario: Scenario;
  tunables: PredictionTunables;
  tickRate: number;
}

function now(): number {
  return performance.timeOrigin + performance.now();
}

export class BotClient {
  private readonly core: GameClientCore;
  private readonly spectator: boolean;
  private behavior: BehaviorFn;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private stopped = false;

  private readonly trace: ClientTrace;
  /** inputs awaiting ack, seq-ordered (for input→ack RTT) */
  private readonly unacked: { seq: number; tSent: number }[] = [];

  constructor(private readonly opts: BotOptions) {
    this.spectator = opts.behaviorKind === "spectator";
    this.behavior = makeBehavior(
      opts.behaviorKind,
      mulberry32(deriveSeed(opts.scenario.seed, `behavior:${opts.name}`)),
    );
    this.trace = {
      clientId: opts.name,
      kind: "bot",
      ...(this.spectator ? {} : { playerId: opts.userId }),
      frames: [],
      snapshots: [],
      corrections: [],
      inputs: [],
      nudges: [],
    };
    this.core = new GameClientCore({
      transport: opts.transport,
      userId: opts.userId,
      tunables: opts.tunables,
      tickRate: opts.tickRate,
      now,
      clockScale: opts.clockScale,
      hooks: {
        onSnapshotArrival: (tWall, tick) => {
          this.trace.snapshots.push({ tWall, tick });
        },
        onInputSent: (frames, tWall) => this.onInputSent(frames, tWall),
        onCorrection: (correction, ack, tWall) => this.onCorrection(correction, ack, tWall),
        onDeath: (death) => this.onDeath(death),
      },
    });
  }

  public async start(): Promise<void> {
    await this.core.start(this.spectator);
    this.lastFrameAt = performance.now();
    this.scheduleRenderFrame();
  }

  /**
   * Resolves once the food this client holds is as of its latest snapshot
   * (no keyframe request in flight, none applied past it), or after
   * `timeoutMs`: the trace then compares it with the server's at that tick.
   */
  public async foodSettled(timeoutMs: number): Promise<void> {
    const until = performance.now() + timeoutMs;
    const { food } = this.core;
    while (
      (food.awaitingKeyframe || food.tick !== this.core.latestTick) &&
      performance.now() < until
    ) {
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, 20);
      });
    }
  }

  public stop(): ClientTrace {
    this.stopped = true;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.core.stop();
    this.trace.food = this.core.foodState();
    return this.trace;
  }

  // ── Render loop ─────────────────────────────────────────────────────────

  private scheduleRenderFrame(): void {
    if (this.stopped) return;
    const elapsed = performance.now() - this.lastFrameAt;
    const wait = Math.max(0, this.currentFrameMs() - elapsed);
    this.renderTimer = setTimeout(() => this.renderFrame(), wait);
  }

  /** Steady 60fps, or a sinusoidal 30-90fps-style oscillation (BotSpec.render). */
  private currentFrameMs(): number {
    const profile = this.opts.render;
    if (!profile) return RENDER_FRAME_MS;
    const tSec = performance.now() / 1000 + (profile.phaseS ?? 0);
    const mid = (profile.minFps + profile.maxFps) / 2;
    const amp = (profile.maxFps - profile.minFps) / 2;
    const fps = mid + amp * Math.sin((2 * Math.PI * tSec) / profile.periodS);
    return 1000 / fps;
  }

  private renderFrame(): void {
    if (this.stopped) return;
    const tNow = performance.now();
    const deltaS = Math.min((tNow - this.lastFrameAt) / 1000, 0.25);
    this.lastFrameAt = tNow;
    const tWall = performance.timeOrigin + tNow;

    // The behavior steers from the predictor's own state, once per step
    const predictor = this.core.localPredictor;
    const tSec = (tWall - this.core.spawnedAtMs) / 1000;
    const rendered = this.core.renderFrame(
      deltaS,
      () =>
        this.behavior({
          tSec,
          selfX: predictor?.simPos.x ?? 0,
          selfY: predictor?.simPos.y ?? 0,
          dirX: predictor?.simDir.x ?? 1,
          dirY: predictor?.simDir.y ?? 0,
          bounds: this.core.worldBounds,
        }),
      tWall,
    );

    // The trace records heads only
    const entities: Record<string, { x: number; y: number }> = {};
    if (rendered.local) entities[this.opts.userId] = { x: rendered.local.x, y: rendered.local.y };
    for (const [id, snake] of rendered.remotes) entities[id] = { x: snake.x, y: snake.y };
    this.trace.frames.push({ tWall, entities });
    this.scheduleRenderFrame();
  }

  // ── What the trace records ──────────────────────────────────────────────

  /** One message left: the step's frame last, with up to three unacknowledged ones before it. */
  private onInputSent(frames: GameInput[], tSent: number): void {
    const frame = frames.at(-1);
    if (!frame) return;
    this.trace.inputs.push({ seq: frame.seq, tSent });
    this.unacked.push({ seq: frame.seq, tSent });
  }

  private onCorrection(correction: Correction, ack: number, tWall: number): void {
    // Resolve input→ack RTT for everything this snapshot acknowledges
    while (this.unacked.length > 0 && (this.unacked[0]?.seq ?? Infinity) <= ack) {
      const acked = this.unacked.shift();
      if (!acked) break;
      const record = this.trace.inputs.find((i) => i.seq === acked.seq);
      if (record) record.tAcked = tWall;
    }
    if (correction.nudged) this.trace.nudges?.push({ tWall });
    this.trace.corrections.push({
      tWall,
      magnitudePx: correction.magnitudePx,
      hard: correction.hard,
    });
  }

  private onDeath(death: GameDeathEvent): void {
    if (death.id !== this.opts.userId) return;
    setTimeout(() => {
      if (!this.stopped) this.core.respawn();
    }, this.opts.scenario.respawnDelayMs).unref?.();
  }
}
