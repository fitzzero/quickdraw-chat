/**
 * WorldClock (netcode variant: HYPOTHESES.md #2 — send-timestamp sync).
 *
 * With `WorldSnapshot.t` (server send time) on the wire, the client no
 * longer infers the server timeline from ARRIVAL cadence (which wobbles
 * with network jitter). Instead:
 *
 *   delay_i   = clientArrival_i − serverSend_i     (offset + one-way delay)
 *   minDelay  = rolling min over the last WINDOW_S (jitter-immune anchor)
 *   tickNow   = tick_i + (clientNow − minDelay − t_i) · tickRate/1000
 *
 * The estimate advances with the client's own clock between snapshots — no
 * per-frame nudge — and re-anchors as fresher snapshots arrive. A slew
 * limiter bounds timeline corrections (window-min shifts, route changes) so
 * they can never pop the rendered world.
 *
 * Falls back to the H1 exponential estimator when snapshots carry no `t`
 * (tolerant parsing — older servers).
 */

/** Pinned to remote_snake.gd:12 */
export const INTERP_DELAY_TICKS = 2.5;

/** H1 fallback: baseline 5%/frame at 60fps ≈ exp decay with τ ≈ 0.325s. */
const CLOCK_TAU_S = 0.3;

/** Rolling window for the min-delay anchor. */
const WINDOW_S = 4;
/** Max timeline correction rate (ticks per second of wall time). */
const MAX_SLEW_TICKS_PER_S = 2;

interface DelaySample {
  arrival: number;
  delayMs: number;
}

export class WorldClock {
  private est = 0;
  private latest = 0;
  private hasEst = false;

  // H2 state
  private readonly samples: DelaySample[] = [];
  private lastTick = 0;
  private lastSendT = 0;
  private hasTimestamps = false;

  constructor(private readonly tickRate: number) {}

  public observe(tick: number, sendT?: number, arrivalMs?: number): void {
    this.latest = Math.max(this.latest, tick);
    if (!this.hasEst) {
      this.est = tick;
      this.hasEst = true;
    }
    if (sendT === undefined || arrivalMs === undefined) return;

    this.hasTimestamps = true;
    if (tick >= this.lastTick) {
      this.lastTick = tick;
      this.lastSendT = sendT;
    }
    this.samples.push({ arrival: arrivalMs, delayMs: arrivalMs - sendT });
    const cutoff = arrivalMs - WINDOW_S * 1000;
    while (this.samples.length > 0 && (this.samples[0]?.arrival ?? Infinity) < cutoff) {
      this.samples.shift();
    }
  }

  /** Advance by wall time; `nowMs` must be the same clock `arrivalMs` used. */
  public advance(deltaS: number, nowMs: number): void {
    if (!this.hasEst) return;

    if (!this.hasTimestamps) {
      // H1 fallback: frame-rate-independent nudge toward the freshest tick
      this.est += deltaS * this.tickRate;
      const k = 1 - Math.exp(-deltaS / CLOCK_TAU_S);
      this.est += (this.latest - this.est) * k;
      return;
    }

    let minDelay = Infinity;
    for (const sample of this.samples) minDelay = Math.min(minDelay, sample.delayMs);
    if (minDelay === Infinity) return;

    const target = this.lastTick + ((nowMs - minDelay - this.lastSendT) * this.tickRate) / 1000;
    // Slew-limit corrections; free-run advancement is never limited
    this.est += deltaS * this.tickRate;
    const error = target - this.est;
    const maxStep = MAX_SLEW_TICKS_PER_S * deltaS;
    this.est += Math.max(-maxStep, Math.min(maxStep, error));
  }

  public renderTick(): number | null {
    return this.hasEst ? this.est - INTERP_DELAY_TICKS : null;
  }
}
