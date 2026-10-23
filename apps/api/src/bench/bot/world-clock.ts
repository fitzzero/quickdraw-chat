/**
 * WorldClock (netcode variants: HYPOTHESES.md #2 — send-timestamp sync, and
 * #3 — adaptive interpolation delay).
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
 * Remote snakes render on a timeline of their own behind the estimate: as
 * far behind as this client's arrivals need (PlaybackDelay), reached by
 * running the render clock 5% fast or slow, never by a jump, and at most
 * PLAYBACK_MAX_AHEAD_TICKS past the newest tick seen (the interpolators'
 * extrapolation budget). A stall holds it there; the delay it grew shrinks
 * back at the warp's pace once snapshots arrive again, from at most
 * PLAYBACK_MAX_LAG_TICKS behind (a longer stall resumes there, a jump).
 *
 * Falls back to the H1 exponential estimator when snapshots carry no `t`
 * (tolerant parsing — older servers).
 */

import {
  PLAYBACK_MAX_AHEAD_TICKS,
  PLAYBACK_MAX_LAG_TICKS,
  PLAYBACK_START_TICKS,
  PlaybackDelay,
} from "./playback-delay.js";

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
  /** The server whose world the clock follows (its hello's `serverId`). */
  private serverId: string | null = null;
  private est = 0;
  private latest = 0;
  private hasEst = false;

  // H2 state
  private readonly samples: DelaySample[] = [];
  private lastTick = 0;
  private lastSendT = 0;
  private hasTimestamps = false;

  // The render timeline (H3: adaptive delay)
  private readonly playback: PlaybackDelay;
  private render = 0;
  private hasRender = false;

  constructor(private readonly tickRate: number) {
    this.playback = new PlaybackDelay(1000 / tickRate);
  }

  /**
   * Follows the world of the server a hello names: another server (a
   * restart: a new world, ticks from 0) starts everything over. The same
   * server's (a reconnect) keeps what the playback delay learned of the
   * link, but not the outage as a gap between arrivals, and the timeline
   * anchors again on the next snapshot, as at the start: the estimate
   * drifted while nothing arrived (the H1 nudge toward a stale tick, a
   * world that paused while its room was empty). Until the bootstrap
   * rebuilds the world, a snake held through the outage moves from its last
   * snapshot before it to the first after it, as with a fixed delay
   * (remote_snake.gd snaps one that moved MAX_GLIDE_PX or more). Pinned to
   * game.gd clock_follow_server.
   */
  public followServer(serverId: string): void {
    if (serverId === this.serverId) {
      this.playback.forgetArrival();
      this.forgetTimeline();
      return;
    }
    this.serverId = serverId;
    this.forgetTimeline();
    this.playback.reset();
  }

  public observe(tick: number, sendT?: number, arrivalMs?: number): void {
    this.latest = Math.max(this.latest, tick);
    if (!this.hasEst) {
      this.est = tick;
      this.hasEst = true;
    }
    if (arrivalMs !== undefined) this.playback.observe(arrivalMs);
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

  /**
   * Advance by wall time; `nowMs` must be the same clock `arrivalMs` used.
   * The render timeline first: its rate follows the delay as it stood
   * between frames, the one remotes were drawn with.
   */
  public advance(deltaS: number, nowMs: number): void {
    if (!this.hasEst) return;
    this.advanceRender(deltaS);
    this.advanceEstimate(deltaS, nowMs);
  }

  /** The tick remotes render at: the render timeline (null before a snapshot). */
  public renderTick(): number | null {
    if (!this.hasEst) return null;
    return this.hasRender ? this.render : this.est - PLAYBACK_START_TICKS;
  }

  /** How far the render timeline is behind the estimate, in ticks (null before a snapshot). */
  public delayTicks(): number | null {
    const render = this.renderTick();
    return render === null ? null : this.est - render;
  }

  private advanceEstimate(deltaS: number, nowMs: number): void {
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

  /**
   * Runs the render clock toward the playback delay's target, at most
   * PLAYBACK_MAX_LAG_TICKS behind the estimate and PLAYBACK_MAX_AHEAD_TICKS
   * past the newest tick. The second bound wins: through a long stall the
   * render clock holds, and the lag cap moves it on (a jump) once snapshots
   * arrive again.
   */
  private advanceRender(deltaS: number): void {
    if (this.hasRender) {
      this.playback.frame(deltaS * 1000);
      this.render += deltaS * this.tickRate * this.playback.rate(this.est - this.render);
    } else {
      this.render = this.est - PLAYBACK_START_TICKS;
      this.hasRender = true;
    }
    this.render = Math.min(
      Math.max(this.render, this.est - PLAYBACK_MAX_LAG_TICKS),
      this.latest + PLAYBACK_MAX_AHEAD_TICKS,
    );
  }

  /** Forgets the timeline: the next snapshot anchors it again. */
  private forgetTimeline(): void {
    this.est = 0;
    this.latest = 0;
    this.hasEst = false;
    this.samples.length = 0;
    this.lastTick = 0;
    this.lastSendT = 0;
    this.hasTimestamps = false;
    this.render = 0;
    this.hasRender = false;
  }
}
