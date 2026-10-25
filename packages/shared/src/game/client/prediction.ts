/**
 * LocalPredictor — 1:1 TS port of the Godot client's local-snake netcode
 * (apps/game/godot/scripts/local_snake.gd): client-side prediction at the
 * fixed tick rate, seq'd pending-input queue (each step's message carries its
 * frame last, with up to three unacknowledged ones before it), reconciliation
 * against PlayerSnap.ack with replay of unacknowledged inputs, corrections folded
 * into an exponentially decaying visual offset (hard snap past 64px), and
 * render interpolation between the previous and current sim states.
 *
 * This port is the Tier-1 stand-in for the real client AND the place where
 * netcode hypotheses get implemented first — keep it in lockstep with
 * local_snake.gd until a variant is promoted, then port the winner to
 * GDScript.
 */

import type { GameInput, PlayerSnap } from "../../types/game.js";
import { GAME_INPUT_FRAMES, GAME_TICK_RATE } from "../../types/game.js";
import type { MovementTunables } from "../movement.js";
import { stepMovement } from "../movement.js";

// Constants pinned to local_snake.gd
const HARD_SNAP_DIST = 64.0;
const CORRECTION_HALF_LIFE = 0.08;
/** The late-rate average's gain per snapshot: about a second of them. */
export const LATE_RATE_GAIN = 1 / 20;
/** The late rate past which the frame clock moves half a tick earlier. */
export const NUDGE_LATE_RATE = 0.2;
/** How much faster the frame clock runs while it gains a nudge's half tick (250 ms at 10 %). */
export const NUDGE_WARP = 0.1;

export interface PredictionTunables extends MovementTunables {
  startLength: number;
}

export interface Correction {
  magnitudePx: number;
  hard: boolean;
  /** the snapshot said `late` and the frame clock moved half a tick earlier */
  nudged: boolean;
}

interface Vec {
  x: number;
  y: number;
}

export class LocalPredictor {
  public seq = 0;
  public simPos: Vec = { x: 0, y: 0 };
  public simDir: Vec = { x: 1, y: 0 };
  public simLen: number;

  private prevSimPos: Vec = { x: 0, y: 0 };
  private readonly pending: GameInput[] = [];
  private accum = 0;
  /** the seq of the last half-tick nudge of the frame clock (onServerSnap) */
  private lastNudgeSeq = 0;
  /** how often the snapshots say `late`, averaged over about a second */
  private lateRate = 0;
  /** what is left of a nudge's half tick for the frame clock to gain (s) */
  private nudgeLeft = 0;
  private visualOffset: Vec = { x: 0, y: 0 };
  private renderedPos: Vec = { x: 0, y: 0 };

  constructor(
    private readonly tunables: PredictionTunables,
    private readonly fixedDt: number,
  ) {
    this.simLen = tunables.startLength;
  }

  /** local_snake.gd init_from_snap */
  public initFromSnap(snap: PlayerSnap): void {
    this.simPos = { x: snap.x, y: snap.y };
    const mag = Math.hypot(snap.dx, snap.dy) || 1;
    this.simDir = { x: snap.dx / mag, y: snap.dy / mag };
    this.simLen = snap.len;
    this.seq = snap.ack;
    this.lastNudgeSeq = this.seq - GAME_TICK_RATE;
    this.lateRate = 0;
    this.nudgeLeft = 0;
    this.prevSimPos = { ...this.simPos };
    this.renderedPos = { ...this.simPos };
    this.visualOffset = { x: 0, y: 0 };
    this.accum = 0;
    this.pending.length = 0;
  }

  /**
   * local_snake.gd _physics_process: advance the fixed-step accumulator
   * (sampling input + stepping the local sim per 50ms boundary), then decay
   * the correction offset and compute the interpolated render position.
   * Returns one message per step taken this render frame, to be sent: the
   * step's frame last, with up to three unacknowledged frames before it
   * (local_snake.gd _step_once sends the same).
   */
  public renderFrame(
    deltaS: number,
    sampleInput: () => { dx: number; dy: number; boost: boolean },
  ): GameInput[][] {
    const messages: GameInput[][] = [];
    // a nudge's half tick, gained a little a frame: the snake runs 10 % fast
    // for a quarter second instead of jumping half a step
    const gain = Math.min(this.nudgeLeft, deltaS * NUDGE_WARP);
    this.nudgeLeft -= gain;
    this.accum += deltaS + gain;
    while (this.accum >= this.fixedDt) {
      this.accum -= this.fixedDt;
      this.prevSimPos = { ...this.simPos };
      this.stepOnce(sampleInput());
      messages.push(this.pending.slice(-GAME_INPUT_FRAMES));
    }

    const decay = Math.pow(0.5, deltaS / CORRECTION_HALF_LIFE);
    this.visualOffset.x *= decay;
    this.visualOffset.y *= decay;
    const alpha = Math.min(Math.max(this.accum / this.fixedDt, 0), 1);
    this.renderedPos = {
      x: this.prevSimPos.x + (this.simPos.x - this.prevSimPos.x) * alpha + this.visualOffset.x,
      y: this.prevSimPos.y + (this.simPos.y - this.prevSimPos.y) * alpha + this.visualOffset.y,
    };
    return messages;
  }

  public getRenderedPos(): Vec {
    return { ...this.renderedPos };
  }

  /** local_snake.gd _step_once */
  private stepOnce(input: { dx: number; dy: number; boost: boolean }): void {
    const mag = Math.hypot(input.dx, input.dy);
    const aim = mag > 1e-6 ? { x: input.dx / mag, y: input.dy / mag } : { ...this.simDir };

    this.seq += 1;
    const frame: GameInput = { seq: this.seq, dx: aim.x, dy: aim.y, boost: input.boost };
    this.pending.push(frame);

    const next = stepMovement(
      {
        x: this.simPos.x,
        y: this.simPos.y,
        dirX: this.simDir.x,
        dirY: this.simDir.y,
        len: this.simLen,
      },
      { targetDx: aim.x, targetDy: aim.y, boost: input.boost },
      this.tunables,
      this.fixedDt,
    );
    this.simPos = { x: next.x, y: next.y };
    this.simDir = { x: next.dirX, y: next.dirY };
    this.simLen = next.len;
  }

  /**
   * local_snake.gd _nudge_phase. The server says `late` when it adopted a
   * frame of ours that landed after a coast stood in for it. When a fifth
   * of the snapshots say so (averaged over about a second), our frames
   * reach it just after its tick: move the frame clock half a tick earlier,
   * off the boundary. A frame jitter or a spike made late now and then
   * (a spike's clump is one snapshot's late) stays under it, so jitter
   * cannot walk the phase around the tick; at most once per half second,
   * never later (the server cannot tell early), and only on the server's
   * word: an ack past our newest frame is also a round trip under a tick.
   * The frame clock gains the half tick over the next quarter second
   * (renderFrame), so what the player sees never jumps.
   */
  private nudgePhase(late: boolean): boolean {
    this.lateRate += ((late ? 1 : 0) - this.lateRate) * LATE_RATE_GAIN;
    if (this.lateRate < NUDGE_LATE_RATE || this.seq - this.lastNudgeSeq < GAME_TICK_RATE / 2) {
      return false;
    }
    this.nudgeLeft += this.fixedDt * 0.5;
    this.lastNudgeSeq = this.seq;
    this.lateRate = 0;
    return true;
  }

  /** local_snake.gd on_server_snap. Returns the applied correction. */
  public onServerSnap(snap: PlayerSnap): Correction {
    while (this.pending.length > 0 && (this.pending[0]?.seq ?? Infinity) <= snap.ack) {
      this.pending.shift();
    }
    // The ack ran past the newest frame: a coast stood in for a frame this
    // client has not stepped yet (a stall of its own, a slow clock, or at a
    // round trip under a tick, a frame that lands just after the tick).
    // Number the next frame after the ack: stepping the stood-in frame here
    // would count its movement twice, a step forward now and back on the
    // next snapshot, and the server refuses its seq anyway.
    if (snap.ack > this.seq) this.seq = snap.ack;
    const nudged = this.nudgePhase(snap.late === true);

    // Replay unacknowledged inputs from the authoritative state
    let rp: Vec = { x: snap.x, y: snap.y };
    const dmag = Math.hypot(snap.dx, snap.dy) || 1;
    let rd: Vec = { x: snap.dx / dmag, y: snap.dy / dmag };
    let rl = snap.len;
    for (const frame of this.pending) {
      const r = stepMovement(
        { x: rp.x, y: rp.y, dirX: rd.x, dirY: rd.y, len: rl },
        { targetDx: frame.dx, targetDy: frame.dy, boost: frame.boost },
        this.tunables,
        this.fixedDt,
      );
      rp = { x: r.x, y: r.y };
      rd = { x: r.dirX, y: r.dirY };
      rl = r.len;
    }

    const errX = rp.x - this.simPos.x;
    const errY = rp.y - this.simPos.y;
    const magnitudePx = Math.hypot(errX, errY);

    if (magnitudePx > HARD_SNAP_DIST) {
      // Lag spike or respawn: teleport rather than smear across the world
      this.simPos = { ...rp };
      this.simDir = { ...rd };
      this.prevSimPos = { ...rp };
      this.visualOffset = { x: 0, y: 0 };
      this.renderedPos = { ...rp };
      this.simLen = rl;
      return { magnitudePx, hard: true, nudged };
    }

    // Adopt the corrected state; keep what the player SEES continuous
    this.visualOffset.x += this.simPos.x - rp.x;
    this.visualOffset.y += this.simPos.y - rp.y;
    this.prevSimPos.x += rp.x - this.simPos.x;
    this.prevSimPos.y += rp.y - this.simPos.y;
    this.simPos = { ...rp };
    this.simDir = { ...rd };
    // Length is server-authoritative (growth comes from server-side eating)
    this.simLen = rl;
    return { magnitudePx, hard: false, nudged };
  }
}
