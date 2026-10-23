/**
 * Remote-entity interpolation on the shared world clock — the 1:1 port of
 * remote_snake.gd (keep the two in lockstep).
 *
 * Every remote of a client renders at the one WorldClock's render tick
 * (HYPOTHESES.md #1–#3: the estimate of the server's tick from send-time
 * stamps, and behind it this client's playback delay, playback-delay.ts),
 * interpolating between the snapshots that bracket it, so all remotes on a
 * screen show the same moment of the world.
 */

import type { PlayerSnap } from "@project/shared";

// Pinned to remote_snake.gd's MAX_EXTRAPOLATION_TICKS, SOFT_STOP_TICKS and
// BUFFER_LIMIT; the render clock runs at most MAX_EXTRAPOLATION_TICKS past the
// newest tick (PLAYBACK_MAX_AHEAD_TICKS, lockstep.test.ts)
export const MAX_EXTRAPOLATION_TICKS = 2.0;
const BUFFER_LIMIT = 40;

// H3b: graceful underrun recovery. The render clock runs at most this
// budget past the newest tick (world-clock.ts, PLAYBACK_MAX_AHEAD_TICKS):
// a late snapshot costs a remote a linear extrapolation, a stall holds it
// at the budget's end, and a remote the newest snapshots lack COASTS to a
// stop over SOFT_STOP_TICKS instead of freezing. When data is back, the raw
// render target jumps — the discontinuity is folded into a fast-decaying
// render offset (the same visual-offset trick local_snake.gd uses for
// reconciliation) so remotes glide back onto the true path instead of
// teleporting. A render clock resuming past a long stall (more than
// PLAYBACK_MAX_LAG_TICKS) jumps the same way.
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
  private offsetX = 0;
  private offsetY = 0;

  constructor(
    private readonly tunables: InterpolationTunables,
    private readonly tickRate: number,
  ) {}

  /** remote_snake.gd push_snap (buffer only — the clock lives in WorldClock) */
  public pushSnap(tick: number, snap: PlayerSnap): void {
    this.lastSeenTick = tick;
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
  }

  /** Render on the shared timeline. Null until a snapshot arrives. */
  public renderFrame(renderTick: number, deltaS: number): { x: number; y: number } | null {
    if (this.buffer.length === 0) return null;
    const target = this.renderAt(renderTick);

    // Fold target discontinuities (stall-recovery jumps) into a decaying
    // glide offset; the threshold scales with frame time so ordinary motion
    // (≤ boost speed) never triggers it.
    if (this.prevTarget) {
      const jumpX = target.x - this.prevTarget.x;
      const jumpY = target.y - this.prevTarget.y;
      const jump = Math.hypot(jumpX, jumpY);
      const plausible = 2.5 * this.tunables.boostSpeed * Math.max(deltaS, 1 / 250);
      if (jump > plausible && jump < MAX_GLIDE_PX) {
        this.offsetX -= jumpX;
        this.offsetY -= jumpY;
      } else if (jump >= MAX_GLIDE_PX) {
        this.offsetX = 0;
        this.offsetY = 0;
      }
    }
    this.prevTarget = target;

    const decay = Math.pow(0.5, deltaS / GLIDE_HALF_LIFE_S);
    this.offsetX *= decay;
    this.offsetY *= decay;
    return { x: target.x + this.offsetX, y: target.y + this.offsetY };
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
      const fixedDt = 1 / this.tickRate;
      let distanceTicks: number;
      if (overRaw <= MAX_EXTRAPOLATION_TICKS) {
        distanceTicks = overRaw;
      } else {
        const coast = Math.min(overRaw - MAX_EXTRAPOLATION_TICKS, SOFT_STOP_TICKS);
        // Integrated distance of a linear speed ramp from 1 → 0
        distanceTicks = MAX_EXTRAPOLATION_TICKS + coast - (coast * coast) / (2 * SOFT_STOP_TICKS);
      }
      return {
        x: before.x + before.dx * speed * fixedDt * distanceTicks,
        y: before.y + before.dy * speed * fixedDt * distanceTicks,
      };
    }

    const t0 = before.tick;
    const t1 = after.tick;
    const t = Math.min(Math.max((renderTick - t0) / Math.max(t1 - t0, 0.001), 0), 1);
    return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
  }
}
