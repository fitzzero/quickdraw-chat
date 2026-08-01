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
  public renderFrame(renderTick: number): { x: number; y: number } | null {
    if (this.buffer.length === 0) return null;
    return this.renderAt(renderTick);
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
      // Underrun: extrapolate along last velocity, capped, then freeze
      const over = Math.min(renderTick - before.tick, MAX_EXTRAPOLATION_TICKS);
      const speed = before.boost ? this.tunables.boostSpeed : this.tunables.baseSpeed;
      const fixedDt = 1 / this.tickRate;
      return {
        x: before.x + before.dx * speed * fixedDt * over,
        y: before.y + before.dy * speed * fixedDt * over,
      };
    }

    const t0 = before.tick;
    const t1 = after.tick;
    const t = Math.min(Math.max((renderTick - t0) / Math.max(t1 - t0, 0.001), 0), 1);
    return { x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t };
  }
}
