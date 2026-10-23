/**
 * PlaybackDelay (netcode variant: HYPOTHESES.md #3 — adaptive interpolation
 * delay). How far behind the world clock a client renders its remote
 * snakes: as little as its own connection allows. Pinned to game.gd's
 * playback section: keep the two in lockstep.
 *
 * Each snapshot arrival updates an exponentially weighted mean (k = 2/201,
 * about the last 200 arrivals: 10 s at 20 Hz) of the time between
 * arrivals, and of its variance; each render frame updates one of the
 * frame time. The target delay is mean + 3σ + a frame, in ticks, clamped
 * to [PLAYBACK_MIN_TICKS, PLAYBACK_MAX_TICKS]: a clean 20 Hz link renders
 * 1.5 ticks behind, a jittery one further, so its buffer does not run dry.
 * Ten seconds of memory hold a spiky link's spikes (one a second) in σ, so
 * it keeps one delay instead of dropping to the floor between spikes. A gap
 * counts as PLAYBACK_MAX_TICKS at most, and a frame as
 * PLAYBACK_MAX_FRAME_MS: one long stall or a hitch (a background tab) does
 * not hold the target up.
 *
 * The render clock never jumps to a new delay (only the lag cap moves it at
 * once, as snapshots resume after a stall longer than about 0.7 s):
 * WorldClock runs it 5% fast
 * while the delay is more than PLAYBACK_DEAD_BAND_MS above the target and
 * 5% slow while it is that much below (`rate`), so a tick of change takes a
 * second of wall time.
 */

/** The least a client renders behind the world clock. */
export const PLAYBACK_MIN_TICKS = 1.5;
/** The most: 300 ms at 20 Hz. */
export const PLAYBACK_MAX_TICKS = 6;
/**
 * Where the render clock starts when a snapshot anchors it (the first one,
 * and the first after a hello): the fixed delay before it.
 */
export const PLAYBACK_START_TICKS = 2.5;
/** How much faster or slower than real time the render clock runs to converge. */
export const PLAYBACK_WARP = 0.05;
/**
 * The most the render clock lags the estimate once snapshots arrive (twice
 * the ceiling): past a long stall it resumes this far behind, not the
 * whole stall behind. Through the stall itself, the bound past the newest
 * tick holds it, and the lag grows.
 */
export const PLAYBACK_MAX_LAG_TICKS = 2 * PLAYBACK_MAX_TICKS;
/**
 * How far past the newest tick the render clock runs before it holds: the
 * interpolators' extrapolation budget (MAX_EXTRAPOLATION_TICKS). A late
 * snapshot then costs a remote a short extrapolation, as with a fixed
 * delay, rather than a stop and a start; a stall holds the render clock
 * there, and the delay grows.
 */
export const PLAYBACK_MAX_AHEAD_TICKS = 2;
/** The weight of each arrival and frame in the exponentially weighted means. */
export const PLAYBACK_EWMA_K = 2 / 201;
/** Standard deviations of the gaps the delay covers. */
export const PLAYBACK_SIGMAS = 3;
/** A delay within this of the target (ms) is left as it is. */
export const PLAYBACK_DEAD_BAND_MS = 5;
/** The longest frame a frame counts as (ms; the bots cap a frame there too). */
export const PLAYBACK_MAX_FRAME_MS = 250;

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
    const gap = Math.min(arrivalMs - last, PLAYBACK_MAX_TICKS * this.tickMs);
    if (this.arrivals === 0) {
      this.meanMs = gap;
    } else {
      // The incremental exponentially weighted mean and variance
      const diff = gap - this.meanMs;
      const step = PLAYBACK_EWMA_K * diff;
      this.meanMs += step;
      this.varianceMs2 = (1 - PLAYBACK_EWMA_K) * (this.varianceMs2 + diff * step);
    }
    this.arrivals++;
  }

  /** A render frame of `frameMs` passed. */
  public frame(frameMs: number): void {
    const sample = Math.min(frameMs, PLAYBACK_MAX_FRAME_MS);
    this.frameMs =
      this.frameMs === null ? sample : this.frameMs + PLAYBACK_EWMA_K * (sample - this.frameMs);
  }

  /** The delay to converge on, in ticks: mean + 3σ + a frame, within the floor and the ceiling. */
  public targetTicks(): number {
    if (this.arrivals === 0) return PLAYBACK_START_TICKS;
    const ms = this.meanMs + PLAYBACK_SIGMAS * Math.sqrt(this.varianceMs2) + (this.frameMs ?? 0);
    return Math.min(PLAYBACK_MAX_TICKS, Math.max(PLAYBACK_MIN_TICKS, ms / this.tickMs));
  }

  /**
   * The render clock's rate for a delay of `delayTicks` now: faster to
   * shorten it, slower to lengthen it, 1 within the dead band.
   */
  public rate(delayTicks: number): number {
    const errorMs = (delayTicks - this.targetTicks()) * this.tickMs;
    if (errorMs > PLAYBACK_DEAD_BAND_MS) return 1 + PLAYBACK_WARP;
    if (errorMs < -PLAYBACK_DEAD_BAND_MS) return 1 - PLAYBACK_WARP;
    return 1;
  }

  /**
   * The connection came back to the same server: the gap since the last
   * arrival before it is the outage, no gap between snapshots.
   */
  public forgetArrival(): void {
    this.lastArrivalMs = null;
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
