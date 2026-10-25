/**
 * Remote-entity interpolation on the shared world clock.
 *
 * Every remote of a client renders at one tick of the WorldClock, so all
 * remotes on a screen show the same moment of the world. Which tick is the
 * client's `RemotesMode`: `playback` renders at the render timeline
 * (HYPOTHESES.md #1–#3: the estimate of the server's tick from send-time
 * stamps, and behind it this client's playback delay, playback-delay.ts),
 * interpolating between the snapshots that bracket it; `present` renders at
 * the estimate itself, which no snapshot has reached yet, so the newest one
 * is extrapolated along its heading at its speed (dead reckoning: a snake
 * moves at a constant speed with a bounded turn, so a trip's worth is
 * accurate until it turns) for the extrapolation budget, and held past it.
 */

import type { PlayerSnap } from "../../types/game.js";

/**
 * Where a client renders its remotes. `playback`: 1.5–6 ticks behind the
 * estimate, smooth, late by the delay and the trip. `present`: at the
 * estimate of the server's tick now, where the server has the snake, at
 * the cost of the overshoot a turn brings and a pop per snapshot. The core
 * picks the tick each interpolator renders at.
 */
export type RemotesMode = "playback" | "present";
export const DEFAULT_REMOTES_MODE: RemotesMode = "playback";

// The render clock runs at most MAX_EXTRAPOLATION_TICKS past the newest tick
// (PLAYBACK_MAX_AHEAD_TICKS); at the present, a remote extrapolates that far
// and coasts to a stop past it
export const MAX_EXTRAPOLATION_TICKS = 2.0;
const BUFFER_LIMIT = 40;

// H3b: graceful underrun recovery. The render clock runs at most this
// budget past the newest tick (world-clock.ts, PLAYBACK_MAX_AHEAD_TICKS):
// a late snapshot costs a remote a linear extrapolation, a stall holds it
// at the budget's end, and a remote the newest snapshots lack COASTS to a
// stop over SOFT_STOP_TICKS instead of freezing. A discontinuity of the raw
// render target is folded into a fast-decaying render offset (the
// visual-offset trick the local predictor uses for reconciliation), so
// remotes glide onto the true path instead of popping: between frames, a
// jump no motion explains (data back after a stall, a render clock resuming
// past a long stall of more than PLAYBACK_MAX_LAG_TICKS); and at a
// snapshot's arrival, however small, the difference it makes at the last
// rendered tick (a late snapshot replacing an extrapolation on playback;
// at the present every snapshot, which re-bases the dead reckoning). A
// respawn-scale jump snaps.
const SOFT_STOP_TICKS = 3.0;
const GLIDE_HALF_LIFE_S = 0.1;
/** Fold jumps below this into the glide; beyond it, snap (respawn-scale). */
const MAX_GLIDE_PX = 200;

interface BufferedSnap {
  tick: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
  boost: boolean;
}

export interface InterpolationTunables {
  baseSpeed: number;
  boostSpeed: number;
}

export class RemoteInterpolator {
  public lastSeenTick = 0;

  private readonly buffer: BufferedSnap[] = [];
  private prevTarget: { x: number; y: number } | null = null;
  private prevTick = 0;
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly tunables: InterpolationTunables,
    private readonly tickRate: number,
  ) {}

  /**
   * Buffers a snapshot of the remote (the clock lives in WorldClock), and
   * folds the difference it makes at the last rendered tick into the glide:
   * the drawn head stays where it was and glides onto the new path.
   */
  public pushSnap(tick: number, snap: PlayerSnap): void {
    this.lastSeenTick = tick;
    const before = this.prevTarget === null ? null : this.renderAt(this.prevTick);
    this.buffer.push({
      tick,
      x: snap.x,
      y: snap.y,
      dx: snap.dx,
      dy: snap.dy,
      len: snap.len,
      boost: snap.boost,
    });
    while (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
    if (before !== null) {
      const after = this.renderAt(this.prevTick);
      this.fold(after.x - before.x, after.y - before.y);
      this.prevTarget = after;
    }
  }

  /** The newest snapshot's heading, length and boost (null before one): what a renderer draws beside the head. */
  public newest(): { dx: number; dy: number; len: number; boost: boolean } | null {
    const snap = this.buffer.at(-1);
    return snap ? { dx: snap.dx, dy: snap.dy, len: snap.len, boost: snap.boost } : null;
  }

  /** Renders at a tick of the shared clock (the mode's). Null until a snapshot arrives. */
  public renderFrame(renderTick: number, deltaS: number): { x: number; y: number } | null {
    if (this.buffer.length === 0) return null;
    const target = this.renderAt(renderTick);

    // Fold a jump no motion explains (stall recovery) into the glide; the
    // threshold scales with frame time so ordinary motion (≤ boost speed)
    // never triggers it
    if (this.prevTarget) {
      const jumpX = target.x - this.prevTarget.x;
      const jumpY = target.y - this.prevTarget.y;
      const plausible = 2.5 * this.tunables.boostSpeed * Math.max(deltaS, 1 / 250);
      if (Math.hypot(jumpX, jumpY) > plausible) this.fold(jumpX, jumpY);
    }
    this.prevTarget = target;
    this.prevTick = renderTick;

    const decay = Math.pow(0.5, deltaS / GLIDE_HALF_LIFE_S);
    this.offsetX *= decay;
    this.offsetY *= decay;
    return { x: target.x + this.offsetX, y: target.y + this.offsetY };
  }

  /** A jump of the raw target into the glide offset; a respawn-scale one snaps instead. */
  private fold(jumpX: number, jumpY: number): void {
    if (Math.hypot(jumpX, jumpY) >= MAX_GLIDE_PX) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    this.offsetX -= jumpX;
    this.offsetY -= jumpY;
  }

  private renderAt(renderTick: number): { x: number; y: number } {
    let before = this.buffer[0];
    let after: BufferedSnap | null = null;
    for (const snap of this.buffer) {
      if (snap.tick <= renderTick) before = snap;
      else {
        after = snap;
        break;
      }
    }
    if (!before) return { x: 0, y: 0 };

    if (!after) {
      // Underrun: linear extrapolation for the budget, then coast to a stop
      // over SOFT_STOP_TICKS (velocity ramps to zero — no hard freeze)
      const overRaw = renderTick - before.tick;
      const speed = before.boost ? this.tunables.boostSpeed : this.tunables.baseSpeed;
      const perTick = speed / this.tickRate;
      let distanceTicks: number;
      if (overRaw <= MAX_EXTRAPOLATION_TICKS) {
        distanceTicks = overRaw;
      } else {
        const coast = Math.min(overRaw - MAX_EXTRAPOLATION_TICKS, SOFT_STOP_TICKS);
        // Integrated distance of a linear speed ramp from 1 → 0
        distanceTicks = MAX_EXTRAPOLATION_TICKS + coast - (coast * coast) / (2 * SOFT_STOP_TICKS);
      }
      return {
        x: before.x + before.dx * perTick * distanceTicks,
        y: before.y + before.dy * perTick * distanceTicks,
      };
    }

    const t0 = before.tick;
    const t1 = after.tick;
    const t = Math.min(Math.max((renderTick - t0) / Math.max(t1 - t0, 0.001), 0), 1);
    return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
  }
}
