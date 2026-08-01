/**
 * BotClient — a headless stand-in for one real game client. Speaks the
 * exact production wire protocol (subscribe → joinGame → input channel →
 * volatile snapshots) through an optional latency proxy, runs the same
 * netcode as the Godot client (LocalPredictor + RemoteInterpolator), and
 * records a ClientTrace for the metrics pipeline.
 *
 * The render loop targets 60Hz like a browser; ACTUAL frame times are
 * recorded, so timer wobble shows up in the data instead of being assumed
 * away. The remote interpolator's per-frame nudge is frame-rate dependent —
 * effectiveFps in the scorecard guards against a bot loop that fell behind.
 */

import { io as ioClient, type Socket } from "socket.io-client";
import type { ClientTrace, Scenario } from "@project/bench";
import { deriveSeed, mulberry32 } from "@project/bench";
import type {
  GameBootstrap,
  GameDeathEvent,
  GameInput,
  PlayerSnap,
  WorldBootstrap,
  WorldSnapshot,
} from "@project/shared";
import { GAME_EVENTS, GLOBAL_WORLD_ID } from "@project/shared";
import { LocalPredictor, type PredictionTunables } from "./prediction.js";
import { RemoteInterpolator } from "./interpolation.js";
import { WorldClock } from "./world-clock.js";
import { makeBehavior, type BehaviorFn } from "./behaviors.js";

const RENDER_FRAME_MS = 1000 / 60;
/** remote_snake pruning: main.gd PRUNE_AFTER_TICKS */
const PRUNE_AFTER_TICKS = 60;
const JOIN_TIMEOUT_MS = 15_000;

const INPUT_EVENT = "channel:gameService:input";

export interface BotOptions {
  /** port to actually connect to (proxy port or the real server port) */
  port: number;
  userId: string;
  name: string;
  behaviorKind: "wander" | "cross" | "orbit" | "spectator";
  scenario: Scenario;
  tunables: PredictionTunables;
  tickRate: number;
}

function now(): number {
  return performance.timeOrigin + performance.now();
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`bot ack timeout: ${event}`)),
      JOIN_TIMEOUT_MS,
    );
    socket.emit(event, payload, (response: { success: boolean; data?: T; error?: string }) => {
      clearTimeout(timeout);
      if (response.success && response.data !== undefined) resolve(response.data);
      else reject(new Error(response.error ?? `bot ack failed: ${event}`));
    });
  });
}

export class BotClient {
  private socket: Socket | null = null;
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
    const socket = ioClient(`http://127.0.0.1:${this.opts.port}`, {
      auth: { userId: this.opts.userId },
      transports: ["websocket"],
      autoConnect: true,
    });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`bot ${this.opts.name}: connect timeout`)),
        JOIN_TIMEOUT_MS,
      );
      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    socket.on(GAME_EVENTS.snapshot, (snapshot: WorldSnapshot) => this.onSnapshot(snapshot));
    socket.on(GAME_EVENTS.death, (death: GameDeathEvent) => this.onDeath(death));
    // Parity with main.gd _on_player_left
    socket.on(GAME_EVENTS.playerLeft, (event: { id: string }) => {
      this.interpolators.delete(event.id);
    });

    // Ordering contract: subscribe FIRST (room membership gates the input
    // channel and snapshot delivery), then join/watch.
    await emitWithAck(socket, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });

    if (this.opts.behaviorKind === "spectator") {
      const bootstrap = await emitWithAck<WorldBootstrap>(socket, "gameService:watchWorld", {
        worldId: GLOBAL_WORLD_ID,
      });
      this.bounds = bootstrap.bounds;
    } else {
      const bootstrap = await emitWithAck<GameBootstrap>(socket, "gameService:joinGame", {
        worldId: GLOBAL_WORLD_ID,
      });
      this.bounds = bootstrap.bounds;
      const own = bootstrap.snaps.find((s) => s.id === this.opts.userId);
      this.predictor = new LocalPredictor(this.opts.tunables, 1 / this.opts.tickRate);
      if (own) this.predictor.initFromSnap(own);
      this.alive = true;
      this.spawnedAt = now();
    }

    this.lastFrameAt = performance.now();
    this.scheduleRenderFrame();
  }

  public stop(): ClientTrace {
    this.stopped = true;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.socket?.close();
    return this.trace;
  }

  // ── Render loop ─────────────────────────────────────────────────────────

  private scheduleRenderFrame(): void {
    if (this.stopped) return;
    const elapsed = performance.now() - this.lastFrameAt;
    const wait = Math.max(0, RENDER_FRAME_MS - elapsed);
    this.renderTimer = setTimeout(() => this.renderFrame(), wait);
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
      const frames = this.predictor.renderFrame(deltaS, () =>
        this.behavior({
          tSec,
          selfX: this.predictor?.simPos.x ?? 0,
          selfY: this.predictor?.simPos.y ?? 0,
          dirX: this.predictor?.simDir.x ?? 1,
          dirY: this.predictor?.simDir.y ?? 0,
          bounds: this.bounds,
        }),
      );
      for (const frame of frames) this.sendInput(frame);
      entities[this.opts.userId] = this.predictor.getRenderedPos();
    }

    this.worldClock.advance(deltaS);
    const renderTick = this.worldClock.renderTick();
    for (const [id, interp] of this.interpolators) {
      if (this.latestTick - interp.lastSeenTick > PRUNE_AFTER_TICKS) {
        this.interpolators.delete(id);
        continue;
      }
      const pos = renderTick === null ? null : interp.renderFrame(renderTick);
      if (pos) entities[id] = pos;
    }

    this.trace.frames.push({ tWall, entities });
    this.scheduleRenderFrame();
  }

  private sendInput(frame: GameInput): void {
    this.socket?.emit(INPUT_EVENT, frame);
    const tSent = now();
    this.trace.inputs.push({ seq: frame.seq, tSent });
    this.unacked.push({ seq: frame.seq, tSent });
  }

  // ── Server events ───────────────────────────────────────────────────────

  private onSnapshot(snapshot: WorldSnapshot): void {
    const tWall = now();
    this.trace.snapshots.push({ tWall, tick: snapshot.tick });
    this.latestTick = snapshot.tick;
    this.worldClock.observe(snapshot.tick);

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
      if (this.stopped || !this.socket) return;
      emitWithAck(this.socket, "gameService:respawn", { worldId: GLOBAL_WORLD_ID }).catch(() => {
        // Respawn can race shutdown; the bot just stays dead
      });
    }, this.opts.scenario.respawnDelayMs).unref?.();
  }
}
