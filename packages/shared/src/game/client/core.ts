/**
 * GameClientCore — what every game client does with the wire, whichever
 * shell drives it: the bench bots (apps/api/src/bench/bot/client.ts, their
 * behaviors and trace around it) and the web page (its input and renderer
 * around it). It is the netcode the Godot client runs too: the local
 * predictor (local_snake.gd), one interpolator per remote snake
 * (remote_snake.gd) on the shared world clock (game.gd), and the food
 * (main.gd), driven by the transport's snapshots, keyframes and events.
 *
 * No React, no DOM, no Node: the clock comes in as `now` (epoch ms, the
 * one the world clock's arrivals and frames share), and the shell calls
 * `renderFrame` once per display frame with the frame's duration, so a
 * worker could run it. What only a shell records (a bench trace) or shows
 * (a death dialog) reaches it through the hooks.
 */

import type { GameDeathEvent, GameInput, PlayerSnap, WorldSnapshot } from "../../types/game.js";
import { FoodTracker } from "./food.js";
import { RemoteInterpolator } from "./interpolation.js";
import { LocalPredictor, type Correction, type PredictionTunables } from "./prediction.js";
import type { GameJoin, GameTransport, GameWire } from "./transport.js";
import { WorldClock } from "./world-clock.js";

/** remote_snake pruning: main.gd PRUNE_AFTER_TICKS */
export const PRUNE_AFTER_TICKS = 60;

/** What the shell samples each step for the local snake: an aim and the boost. */
export interface GameClientInput {
  dx: number;
  dy: number;
  boost: boolean;
}

/** What a shell may record or react to; every hook is optional. */
export interface GameClientHooks {
  /** A snapshot arrived, at `tWall` on the core's clock (before the out-of-order guard). */
  onSnapshotArrival?(tWall: number, tick: number): void;
  /** One input message left: the step's frame last, with up to three unacknowledged ones before it. */
  onInputSent?(frames: GameInput[], tWall: number): void;
  /** The local snake reconciled against a snapshot that acknowledged `ack`. */
  onCorrection?(correction: Correction, ack: number, tWall: number): void;
  /** The local snake spawned: with the join (`snap` may be null then), or again after a death. */
  onSpawn?(snap: PlayerSnap | null, tWall: number): void;
  /** A death: the local snake's (`alive` is false now) or a remote's (its interpolator is gone). */
  onDeath?(death: GameDeathEvent): void;
  /** A player left the world (its interpolator is gone). */
  onLeft?(id: string): void;
}

export interface GameClientOptions {
  /** The wire: the server's socket, or a link to a party's host. */
  transport: GameTransport;
  /** The user whose snake is the local one. */
  userId: string;
  tunables: PredictionTunables;
  tickRate: number;
  /** Epoch ms: the clock the world clock's arrivals and frames share (`performance.timeOrigin + performance.now()`). */
  now: () => number;
  /**
   * Scales the time the predictor sees (default 1): its fixed steps, so the
   * frames it sends, while the world and render clocks stay on wall time
   * (a client whose tick clock drifts; the bench's BotSpec.clockScale).
   */
  clockScale?: number;
  hooks?: GameClientHooks;
}

/** One display frame's output: where to draw everything. */
export interface RenderedWorld {
  /** The local snake's rendered position (null while spectating or dead). */
  local: { x: number; y: number } | null;
  /** Every remote snake's rendered position, by player id. */
  remotes: Map<string, { x: number; y: number }>;
  /** The tick the remotes rendered at (null before a snapshot). */
  renderTick: number | null;
}

export class GameClientCore {
  /** The food this client holds (food.ts, the port of main.gd's). */
  public readonly food = new FoodTracker();
  public readonly worldClock: WorldClock;
  private predictor: LocalPredictor | null = null;
  private readonly interpolators = new Map<string, RemoteInterpolator>();
  private readonly transport: GameTransport;
  private readonly hooks: GameClientHooks;
  private readonly clockScale: number;
  private bounds = { w: 0, h: 0 };
  private alive = false;
  private spawnedAt = 0;
  private latest = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.transport = opts.transport;
    this.hooks = opts.hooks ?? {};
    this.clockScale = opts.clockScale ?? 1;
    this.worldClock = new WorldClock(opts.tickRate);
  }

  /** Connects and joins the world, as a player or a spectator; a player's predictor starts here. */
  public async start(spectator: boolean): Promise<GameJoin> {
    const wire: GameWire = {
      follow: (serverId) => {
        // another server's world counts its ticks from the start
        this.latest = 0;
        this.worldClock.followServer(serverId);
      },
      snapshot: (snapshot) => this.onSnapshot(snapshot),
      keyframe: (keyframe) => this.food.keyframe(keyframe),
      death: (death) => this.onDeath(death),
      // Parity with main.gd _on_player_left
      left: (id) => {
        this.interpolators.delete(id);
        this.hooks.onLeft?.(id);
      },
    };
    const joined = await this.transport.start(wire, spectator);
    this.bounds = joined.bounds;
    if (!spectator) this.spawnLocal(joined.own ?? null);
    return joined;
  }

  /**
   * The local snake plays: with its snake when the join answered one, else
   * the first own snapshot places it (main.gd spawns the local snake when
   * its id appears in a snapshot).
   */
  public spawnLocal(own: PlayerSnap | null): void {
    this.predictor = new LocalPredictor(this.opts.tunables, 1 / this.opts.tickRate);
    if (own) this.predictor.initFromSnap(own);
    this.alive = true;
    this.spawnedAt = this.opts.now();
    this.hooks.onSpawn?.(own, this.spawnedAt);
  }

  /** Back to spectating: no local snake, no input. */
  public dropLocal(): void {
    this.predictor = null;
    this.alive = false;
  }

  /** The world's bounds, as the join answered them. */
  public get worldBounds(): { w: number; h: number } {
    return this.bounds;
  }

  /** The local snake's predictor (null while spectating); its `simPos` and `simDir` are what a behavior steers from. */
  public get localPredictor(): LocalPredictor | null {
    return this.predictor;
  }

  /** The local snake is in the world (false while spectating, and between a death and the respawn's snapshot). */
  public get isAlive(): boolean {
    return this.alive;
  }

  /** When the local snake last spawned, on the core's clock. */
  public get spawnedAtMs(): number {
    return this.spawnedAt;
  }

  /** The newest snapshot's tick (0 before one, and again after another server's hello). */
  public get latestTick(): number {
    return this.latest;
  }

  /**
   * Missed more snapshots than the food window repeats, or a player the
   * snapshots no longer introduce: a keyframe puts the food and the names right.
   */
  public requestKeyframe(): void {
    const ended = (): void => this.food.resyncEnded();
    this.transport.requestKeyframe().then(ended, ended);
  }

  /** Asks to respawn after a death; the next own snapshot places the snake again. */
  public respawn(): void {
    this.transport.respawn();
  }

  /** Leaves the wire. */
  public stop(): void {
    this.transport.close();
  }

  /** The food held at the end, for a trace: as of `tick`, against the newest snapshot's. */
  public foodState(): { tick: number; latestTick: number; ids: string[]; resyncs: number } {
    return {
      tick: this.food.tick,
      latestTick: this.latest,
      ids: this.food.ids(),
      resyncs: this.food.resyncs,
    };
  }

  // ── Render loop ─────────────────────────────────────────────────────────

  /**
   * One display frame of `deltaS`: steps the local predictor on its fixed
   * grid (sending each step's message), advances the world and render
   * clocks, and renders every remote at the render tick. `tWall` is the
   * frame's time on the core's clock (the default reads it).
   */
  public renderFrame(
    deltaS: number,
    sampleInput: () => GameClientInput,
    tWall: number = this.opts.now(),
  ): RenderedWorld {
    let local: { x: number; y: number } | null = null;
    if (this.predictor && this.alive) {
      // Only the predictor's clock drifts (clockScale): its fixed steps, so
      // the frames it sends; the world and render clocks do not
      const messages = this.predictor.renderFrame(deltaS * this.clockScale, sampleInput);
      for (const frames of messages) this.sendInput(frames, tWall);
      local = this.predictor.getRenderedPos();
    }

    this.worldClock.advance(deltaS, tWall);
    const renderTick = this.worldClock.renderTick();
    const remotes = new Map<string, { x: number; y: number }>();
    for (const [id, interp] of this.interpolators) {
      if (this.latest - interp.lastSeenTick > PRUNE_AFTER_TICKS) {
        this.interpolators.delete(id);
        continue;
      }
      const pos = renderTick === null ? null : interp.renderFrame(renderTick, deltaS);
      if (pos) remotes.set(id, pos);
    }
    return { local, remotes, renderTick };
  }

  /** One message: the step's frame last, with up to three unacknowledged ones before it. */
  private sendInput(frames: GameInput[], tWall: number): void {
    if (frames.length === 0) return;
    this.transport.sendInput(frames);
    this.hooks.onInputSent?.(frames, tWall);
  }

  // ── The wire's word ─────────────────────────────────────────────────────

  private onSnapshot(snapshot: WorldSnapshot): void {
    const tWall = this.opts.now();
    this.hooks.onSnapshotArrival?.(tWall, snapshot.tick);
    // An older snapshot after a newer one (a party's `fast` channel is
    // unordered) says nothing new: reconciling against it would move the
    // snake a step back and forward again (main.gd _on_snapshot)
    if (snapshot.tick < this.latest) return;
    this.latest = snapshot.tick;
    this.worldClock.observe(snapshot.tick, snapshot.t, tWall);
    if (this.food.apply(snapshot) || (this.transport.needsKeyframe && this.food.askKeyframe())) {
      this.requestKeyframe();
    }

    for (const snap of snapshot.players) {
      if (snap.id === this.opts.userId) {
        if (this.predictor) this.onOwnSnap(snap, tWall);
        continue;
      }
      let interp = this.interpolators.get(snap.id);
      if (!interp) {
        interp = new RemoteInterpolator(this.opts.tunables, this.opts.tickRate);
        this.interpolators.set(snap.id, interp);
      }
      interp.pushSnap(snapshot.tick, snap);
    }
  }

  private onOwnSnap(snap: PlayerSnap, tWall: number): void {
    if (!this.predictor) return;

    // Respawn: first own snap after death re-initializes prediction
    if (!this.alive) {
      this.predictor.initFromSnap(snap);
      this.alive = true;
      this.spawnedAt = tWall;
      this.hooks.onSpawn?.(snap, tWall);
      return;
    }

    const correction = this.predictor.onServerSnap(snap);
    this.hooks.onCorrection?.(correction, snap.ack, tWall);
  }

  private onDeath(death: GameDeathEvent): void {
    // Mirror main.gd _on_player_died: drop dead remotes immediately so no
    // frozen ghost keeps rendering until the prune timeout
    if (death.id === this.opts.userId) {
      this.alive = false;
    } else {
      this.interpolators.delete(death.id);
    }
    this.hooks.onDeath?.(death);
  }
}
