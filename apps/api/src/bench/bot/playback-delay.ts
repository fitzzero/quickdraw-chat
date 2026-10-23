/**
 * PlaybackDelay (netcode variant: HYPOTHESES.md #3 — adaptive interpolation
 * delay). How far behind the world clock a client renders its remote
 * snakes: as little as its own connection allows. Pinned to game.gd's
 * playback section: keep the two in lockstep.
 *
 * Each snapshot arrival updates an exponentially weighted mean (k = 2/31,
 * about the last 30 arrivals) of the time between arrivals, and of its
 * variance; each render frame updates one of the frame time. The target
 * delay is mean + 3σ + a frame, in ticks, clamped to [PLAYBACK_MIN_TICKS,
 * PLAYBACK_MAX_TICKS]: a clean 20 Hz link renders 1.5 ticks behind, a
 * jittery one further, so its buffer does not run dry.
 *
 * The render clock never jumps to a new delay: WorldClock runs it 5% fast
 * while the delay is more than DEAD_BAND_MS above the target and 5% slow
 * while it is that much below (`rate`), so a tick of change takes a second
 * of wall time.
 */

/** The least a client renders behind the world clock. */
export const PLAYBACK_MIN_TICKS = 1.5;
/** The most: 300 ms at 20 Hz. */
export const PLAYBACK_MAX_TICKS = 6;
/** Where the render clock starts, before it has seen arrivals: the fixed delay before it. */
export const PLAYBACK_START_TICKS = 2.5;
/** How much faster or slower than real time the render clock runs to converge. */
export const PLAYBACK_WARP = 0.05;

const EWMA_K = 2 / 31;
const SIGMAS = 3;
/** A delay within this of the target (ms) is left as it is. */
const DEAD_BAND_MS = 5;

export class PlaybackDelay {
  private lastArrivalMs: number | null = null;
  private meanMs = 0;
  private varianceMs2 = 0;
  private arrivals = 0;
  private frameMs: number | null = null;

  constructor(private readonly tickMs: number) {}

  /** A snapshot arrived, at `arrivalMs` on a clock that only moves forward. */
  public observe(arrivalMs: number): void {
    const last = this.lastArrivalMs;
    this.lastArrivalMs = arrivalMs;
    if (last === null) return;
    const gap = arrivalMs - last;
    if (this.arrivals === 0) {
      this.meanMs = gap;
    } else {
      // The incremental exponentially weighted mean and variance
      const diff = gap - this.meanMs;
      const step = EWMA_K * diff;
      this.meanMs += step;
      this.varianceMs2 = (1 - EWMA_K) * (this.varianceMs2 + diff * step);
    }
    this.arrivals++;
  }

  /** A render frame of `frameMs` passed. */
  public frame(frameMs: number): void {
    this.frameMs =
      this.frameMs === null ? frameMs : this.frameMs + EWMA_K * (frameMs - this.frameMs);
  }

  /** The delay to converge on, in ticks. */
  public targetTicks(): number {
    if (this.arrivals === 0) return PLAYBACK_START_TICKS;
    const ms = this.meanMs + SIGMAS * Math.sqrt(this.varianceMs2) + (this.frameMs ?? 0);
    return Math.min(PLAYBACK_MAX_TICKS, Math.max(PLAYBACK_MIN_TICKS, ms / this.tickMs));
  }

  /**
   * The render clock's rate for a delay of `delayTicks` now: faster to
   * shorten it, slower to lengthen it, 1 within the dead band.
   */
  public rate(delayTicks: number): number {
    const errorMs = (delayTicks - this.targetTicks()) * this.tickMs;
    if (errorMs > DEAD_BAND_MS) return 1 + PLAYBACK_WARP;
    if (errorMs < -DEAD_BAND_MS) return 1 - PLAYBACK_WARP;
    return 1;
  }

  /** Forgets the arrivals and frames (another server's world). */
  public reset(): void {
    this.lastArrivalMs = null;
    this.meanMs = 0;
    this.varianceMs2 = 0;
    this.arrivals = 0;
    this.frameMs = null;
  }
}
