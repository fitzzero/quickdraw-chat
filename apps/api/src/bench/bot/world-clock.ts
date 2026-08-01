/**
 * WorldClock — one shared server-timeline estimate per client (netcode
 * variant: HYPOTHESES.md #1). Replaces remote_snake.gd's per-entity,
 * frame-rate-dependent tick estimators. See interpolation.ts header.
 */

/** Pinned to remote_snake.gd:12 */
export const INTERP_DELAY_TICKS = 2.5;

/** Baseline 5%/frame at 60fps ≈ exp decay with τ ≈ 0.325s; keep comparable. */
const CLOCK_TAU_S = 0.3;

/**
 * One shared server-timeline estimate per client. `observe` on every
 * snapshot arrival; `advance` once per render frame.
 */
export class WorldClock {
  private est = 0;
  private latest = 0;
  private hasEst = false;

  constructor(private readonly tickRate: number) {}

  public observe(tick: number): void {
    this.latest = Math.max(this.latest, tick);
    if (!this.hasEst) {
      this.est = tick;
      this.hasEst = true;
    }
  }

  /** Advance by wall time with a frame-rate-independent nudge toward the freshest tick. */
  public advance(deltaS: number): void {
    if (!this.hasEst) return;
    this.est += deltaS * this.tickRate;
    const k = 1 - Math.exp(-deltaS / CLOCK_TAU_S);
    this.est += (this.latest - this.est) * k;
  }

  public renderTick(): number | null {
    return this.hasEst ? this.est - INTERP_DELAY_TICKS : null;
  }
}
