/**
 * A snake's body, derived from where its head has been: only heads travel
 * on the wire, and the server derives the body the same way.
 * Engine-neutral: a renderer places a segment sprite at each position this
 * walk yields.
 */

import type { RenderTunables } from "./renderer";

export interface BodySegment {
  x: number;
  y: number;
  /** The segment's radius: the body's, tapering to 70 % at the tail. */
  radius: number;
  /** Its place behind the head, 0 first. */
  index: number;
}

export class BodyPath {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];

  /** Starts the history over at a head (a spawn, a hard snap). */
  public reset(x: number, y: number): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.xs.push(x);
    this.ys.push(y);
  }

  /**
   * A new sample every `sampleSpacing` px of head travel, keeping as much
   * history as a body of `length` segments needs.
   */
  public advance(x: number, y: number, length: number, t: RenderTunables): void {
    const n = this.xs.length;
    if (n === 0) {
      this.xs.push(x);
      this.ys.push(y);
      return;
    }
    const lx = this.xs[n - 1] ?? x;
    const ly = this.ys[n - 1] ?? y;
    if (Math.hypot(x - lx, y - ly) < t.sampleSpacing) return;
    this.xs.push(x);
    this.ys.push(y);
    const maxSamples = Math.ceil((length * t.segmentSpacing) / t.sampleSpacing) + 4;
    while (this.xs.length > maxSamples) {
      this.xs.shift();
      this.ys.shift();
    }
  }

  /** How many samples the history holds. */
  public get size(): number {
    return this.xs.length;
  }

  /**
   * The walk: from the head at (hx, hy) back along the history, one
   * segment every `segmentSpacing` px of arc length, `length` of them at
   * most. Fills `out` (reusing its objects) and returns the count.
   */
  public segments(
    hx: number,
    hy: number,
    length: number,
    t: RenderTunables,
    out: BodySegment[],
  ): number {
    const count = Math.trunc(length);
    let placed = 0;
    let walk = 0;
    let nextAt = t.segmentSpacing;
    let px = hx;
    let py = hy;
    for (let i = this.xs.length - 1; i >= 0 && placed < count; i--) {
      const sx = this.xs[i] ?? px;
      const sy = this.ys[i] ?? py;
      const step = Math.hypot(px - sx, py - sy);
      while (walk + step >= nextAt && placed < count) {
        const f = (nextAt - walk) / Math.max(step, 0.001);
        let seg = out[placed];
        if (seg === undefined) {
          seg = { x: 0, y: 0, radius: 0, index: 0 };
          out[placed] = seg;
        }
        seg.x = px + (sx - px) * f;
        seg.y = py + (sy - py) * f;
        seg.radius = t.bodyRadius * (1 - (0.3 * placed) / Math.max(count, 1));
        seg.index = placed;
        placed += 1;
        nextAt += t.segmentSpacing;
      }
      walk += step;
      px = sx;
      py = sy;
    }
    return placed;
  }
}
