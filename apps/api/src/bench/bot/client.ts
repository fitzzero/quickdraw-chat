/**
 * BotClient — a headless stand-in for one real game client. Its transport
 * carries the wire: the production one, quickdraw protocol v5 as the Godot
 * client speaks it, through an optional latency proxy (socket-transport.ts),
 * or a loopback link to a party's host in process (party-transport.ts). It
 * runs the same netcode as the Godot client (LocalPredictor +
 * RemoteInterpolator, the world clock, the food) and records a ClientTrace
 * for the metrics pipeline.
 *
 * The render loop targets 60Hz like a browser; ACTUAL frame times are
 * recorded, so timer wobble shows up in the data instead of being assumed
 * away. The remote interpolator's per-frame nudge is frame-rate dependent —
 * effectiveFps in the scorecard guards against a bot loop that fell behind.
 */

import type { ClientTrace, Scenario } from "@project/bench";
import { deriveSeed, mulberry32 } from "@project/bench";
import type { GameDeathEvent, GameInput, PlayerSnap, WorldSnapshot } from "@project/shared";
import { FoodTracker } from "./food.js";
import { LocalPredictor, type PredictionTunables } from "./prediction.js";
import { RemoteInterpolator } from "./interpolation.js";
import { WorldClock } from "./world-clock.js";
import { makeBehavior, type BehaviorFn } from "./behaviors.js";
import type { BotTransport, BotWire } from "./transport.js";

const RENDER_FRAME_MS = 1000 / 60;
/** remote_snake pruning: main.gd PRUNE_AFTER_TICKS */
const PRUNE_AFTER_TICKS = 60;

export interface BotOptions {
  /** The wire: the server's socket, or a loopback link to a party's host. */
  transport: BotTransport;
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
  private readonly transport: BotTransport;
  /** The food this client holds (food.ts, the port of main.gd's). */
  private readonly food = new FoodTracker();
  private readonly worldClock: WorldClock;
  private predictor: LocalPredictor | null = null;
  private readonly interpolators = new Map<string, RemoteInterpolator>();
  private behavior: BehaviorFn;
  private bounds = { w: 0, h: 0 };
  private alive = false;
  private spawnedAt = 0;
  private latestTick = 0;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private stopped = false;

  private readonly trace: ClientTrace;
  /** inputs awaiting ack, seq-ordered (for input→ack RTT) */
  private readonly unacked: { seq: number; tSent: number }[] = [];

  constructor(private readonly opts: BotOptions) {
    this.transport = opts.transport;
    this.worldClock = new WorldClock(opts.tickRate);
    this.behavior = makeBehavior(
      opts.behaviorKind,
      mulberry32(deriveSeed(opts.scenario.seed, `behavior:${opts.name}`)),
    );
    this.trace = {
      clientId: opts.name,
      kind: "bot",
      ...(opts.behaviorKind === "spectator" ? {} : { playerId: opts.userId }),
      frames: [],
      snapshots: [],
      corrections: [],
      inputs: [],
    };
  }

  public async start(): Promise<void> {
    const wire: BotWire = {
      follow: (serverId) => {
        // another server's world counts its ticks from the start
        this.latestTick = 0;
        this.worldClock.followServer(serverId);
      },
      snapshot: (snapshot) => this.onSnapshot(snapshot),
      keyframe: (keyframe) => this.food.keyframe(keyframe),
      death: (death) => this.onDeath(death),
      // Parity with main.gd _on_player_left
      left: (id) => this.interpolators.delete(id),
    };
    const spectator = this.opts.behaviorKind === "spectator";
    const joined = await this.transport.start(wire, spectator);
    this.bounds = joined.bounds;
    if (!spectator) {
      this.predictor = new LocalPredictor(this.opts.tunables, 1 / this.opts.tickRate);
      if (joined.own) this.predictor.initFromSnap(joined.own);
      this.alive = true;
      this.spawnedAt = now();
    }

    this.lastFrameAt = performance.now();
    this.scheduleRenderFrame();
  }

  /**
   * Missed more snapshots than the food window repeats, or a player the
   * snapshots no longer introduce: a keyframe puts the food and the names right.
   */
  private requestKeyframe(): void {
    const ended = (): void => this.food.resyncEnded();
    this.transport.requestKeyframe().then(ended, ended);
  }

  /**
   * Resolves once the food this client holds is as of its latest snapshot
   * (no keyframe request in flight, none applied past it), or after
   * `timeoutMs`: the trace then compares it with the server's at that tick.
   */
  public async foodSettled(timeoutMs: number): Promise<void> {
    const until = performance.now() + timeoutMs;
    while (
      (this.food.awaitingKeyframe || this.food.tick !== this.latestTick) &&
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
    this.transport.close();
    this.trace.food = {
      tick: this.food.tick,
      latestTick: this.latestTick,
      ids: this.food.ids(),
      resyncs: this.food.resyncs,
    };
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

    const entities: Record<string, { x: number; y: number }> = {};

    if (this.predictor && this.alive) {
      const tSec = (tWall - this.spawnedAt) / 1000;
      // Only the predictor's clock drifts (BotSpec.clockScale): its fixed
      // steps, so the frames it sends; the world and render clocks do not
      const messages = this.predictor.renderFrame(deltaS * (this.opts.clockScale ?? 1), () =>
        this.behavior({
          tSec,
          selfX: this.predictor?.simPos.x ?? 0,
          selfY: this.predictor?.simPos.y ?? 0,
          dirX: this.predictor?.simDir.x ?? 1,
          dirY: this.predictor?.simDir.y ?? 0,
          bounds: this.bounds,
        }),
      );
      for (const frames of messages) this.sendInput(frames);
      entities[this.opts.userId] = this.predictor.getRenderedPos();
    }

    this.worldClock.advance(deltaS, tWall);
    const renderTick = this.worldClock.renderTick();
    for (const [id, interp] of this.interpolators) {
      if (this.latestTick - interp.lastSeenTick > PRUNE_AFTER_TICKS) {
        this.interpolators.delete(id);
        continue;
      }
      const pos = renderTick === null ? null : interp.renderFrame(renderTick, deltaS);
      if (pos) entities[id] = pos;
    }

    this.trace.frames.push({ tWall, entities });
    this.scheduleRenderFrame();
  }

  /** One message: the step's frame last, with up to three unacknowledged ones before it. */
  private sendInput(frames: GameInput[]): void {
    const frame = frames.at(-1);
    if (!frame) return;
    this.transport.sendInput(frames);
    const tSent = now();
    this.trace.inputs.push({ seq: frame.seq, tSent });
    this.unacked.push({ seq: frame.seq, tSent });
  }

  // ── Server events ───────────────────────────────────────────────────────

  private onSnapshot(snapshot: WorldSnapshot): void {
    const tWall = now();
    this.trace.snapshots.push({ tWall, tick: snapshot.tick });
    // An older snapshot after a newer one (a party's `fast` channel is
    // unordered) says nothing new: reconciling against it would move the
    // snake a step back and forward again (main.gd _on_snapshot)
    if (snapshot.tick < this.latestTick) return;
    this.latestTick = snapshot.tick;
    this.worldClock.observe(snapshot.tick, snapshot.t, tWall);
    if (this.food.apply(snapshot) || (this.transport.needsKeyframe && this.food.askKeyframe())) {
      this.requestKeyframe();
    }

    for (const snap of snapshot.players) {
      if (snap.id === this.opts.userId && this.predictor) {
        this.onOwnSnap(snap, tWall);
      } else if (snap.id !== this.opts.userId) {
        let interp = this.interpolators.get(snap.id);
        if (!interp) {
          interp = new RemoteInterpolator(this.opts.tunables, this.opts.tickRate);
          this.interpolators.set(snap.id, interp);
        }
        interp.pushSnap(snapshot.tick, snap);
      }
    }
  }

  private onOwnSnap(snap: PlayerSnap, tWall: number): void {
    if (!this.predictor) return;

    // Respawn: first own snap after death re-initializes prediction
    if (!this.alive) {
      this.predictor.initFromSnap(snap);
      this.alive = true;
      this.spawnedAt = tWall;
      return;
    }

    // Resolve input→ack RTT for everything this snapshot acknowledges
    while (this.unacked.length > 0 && (this.unacked[0]?.seq ?? Infinity) <= snap.ack) {
      const acked = this.unacked.shift();
      if (!acked) break;
      const record = this.trace.inputs.find((i) => i.seq === acked.seq);
      if (record) record.tAcked = tWall;
    }

    const correction = this.predictor.onServerSnap(snap);
    this.trace.corrections.push({
      tWall,
      magnitudePx: correction.magnitudePx,
      hard: correction.hard,
    });
  }

  private onDeath(death: GameDeathEvent): void {
    // Mirror main.gd _on_player_died: drop dead remotes immediately so no
    // frozen ghost keeps rendering until the prune timeout
    if (death.id !== this.opts.userId) {
      this.interpolators.delete(death.id);
      return;
    }
    this.alive = false;
    setTimeout(() => {
      if (!this.stopped) this.transport.respawn();
    }, this.opts.scenario.respawnDelayMs).unref?.();
  }
}
