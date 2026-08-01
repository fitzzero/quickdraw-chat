/**
 * Remote-entity interpolation (netcode variant: GLOBAL WORLD CLOCK).
 *
 * Baseline (remote_snake.gd) keeps a per-entity tick estimator nudged 5%
 * per render frame toward that entity's freshest snapshot — so two remotes
 * on one screen can render at slightly different world times, and the
 * convergence rate depends on the client's frame rate.
 *
 * This variant (HYPOTHESES.md #1) replaces them with ONE WorldClock per
 * client, fed by every snapshot arrival, advanced with a frame-rate-
 * independent exponential nudge (time-constant form). All interpolators
 * render at the same `clock − INTERP_DELAY_TICKS` timeline. τ = 0.3s is
 * chosen to match the baseline's convergence speed at 60fps, isolating
 * "shared + frame-rate independent" as the only change.
 *
 * GDScript port (if kept): move the estimator into game.gd (or a small
 * WorldClock autoload) and pass render_tick into RemoteSnake._render_at.
 */

import type { PlayerSnap } from "@project/shared";

// Pinned to remote_snake.gd:12-14
const MAX_EXTRAPOLATION_TICKS = 2.0;
const BUFFER_LIMIT = 40;

// H3b: graceful stall recovery. Past the linear extrapolation budget the
// snake COASTS to a stop over SOFT_STOP_TICKS instead of freezing; when
// data resumes (buffer refill after a stall), the raw render target jumps —
// the discontinuity is folded into a fast-decaying render offset (the same
// visual-offset trick local_snake.gd uses for reconciliation) so remotes
// glide back onto the true path instead of teleporting. Delay stays the
// uniform 2.5 ticks, preserving cross-client timeline alignment.
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
