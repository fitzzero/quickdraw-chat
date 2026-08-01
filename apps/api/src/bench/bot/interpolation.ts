/**
 * RemoteInterpolator — 1:1 TS port of the Godot client's remote-snake
 * netcode (apps/game/godot/scripts/remote_snake.gd): per-entity snapshot
 * jitter buffer, wall-clock tick estimator nudged toward the freshest
 * snapshot, rendering INTERP_DELAY_TICKS in the past with bounded
 * dead-reckoning on buffer underrun.
 *
 * Known quirks faithfully preserved (they are netcode R&D targets):
 * - the tick estimator is per-entity, not a shared world clock;
 * - the 5% nudge is applied per render frame, making convergence
 *   frame-rate dependent.
 */

import type { PlayerSnap } from "@project/shared";

// Constants pinned to remote_snake.gd:12-14
const INTERP_DELAY_TICKS = 2.5;
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
  private tickEst = 0;
  private hasEst = false;

  constructor(
    private readonly tunables: InterpolationTunables,
    private readonly tickRate: number,
  ) {}

  /** remote_snake.gd push_snap */
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

    if (!this.hasEst) {
      this.tickEst = tick;
      this.hasEst = true;
    }
  }

  /** remote_snake.gd _process → _render_at. Null until a snapshot arrives. */
  public renderFrame(deltaS: number): { x: number; y: number } | null {
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest || !this.hasEst) return null;

    // Advance the server-clock estimate by wall time, gently nudged toward
    // the freshest snapshot so drift never accumulates.
    this.tickEst += deltaS * this.tickRate;
    this.tickEst += (latest.tick - this.tickEst) * 0.05;

    return this.renderAt(this.tickEst - INTERP_DELAY_TICKS);
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
