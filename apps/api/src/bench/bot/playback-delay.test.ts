import { mulberry32 } from "@project/bench";
import { describe, expect, it } from "vitest";
import {
  PLAYBACK_MAX_AHEAD_TICKS,
  PLAYBACK_MAX_LAG_TICKS,
  PLAYBACK_MAX_TICKS,
  PLAYBACK_MIN_TICKS,
  PLAYBACK_START_TICKS,
  PLAYBACK_WARP,
  PlaybackDelay,
} from "./playback-delay.js";
import { WorldClock } from "./world-clock.js";

const TICK_MS = 50;
const FRAME_MS = 1000 / 60;
/** One frame's ticks at the warp's fastest, and a rounding error. */
const FASTEST_FRAME_TICKS = (FRAME_MS / TICK_MS) * (1 + PLAYBACK_WARP) + 1e-9;

/** A delay that saw `count` arrivals `gap(i)` apart, at 60 fps. */
function fed(count: number, gap: (i: number) => number): PlaybackDelay {
  const delay = new PlaybackDelay(TICK_MS);
  let at = 0;
  for (let i = 0; i < count; i++) {
    at += gap(i);
    delay.observe(at);
    delay.frame(FRAME_MS);
  }
  return delay;
}

describe("PlaybackDelay", () => {
  it("starts at the fixed delay before it saw two arrivals", () => {
    const delay = new PlaybackDelay(TICK_MS);
    expect(delay.targetTicks()).toBe(PLAYBACK_START_TICKS);
    delay.observe(0);
    expect(delay.targetTicks()).toBe(PLAYBACK_START_TICKS);
  });

  it("renders a clean 20 Hz link at the floor", () => {
    expect(fed(100, () => TICK_MS).targetTicks()).toBe(PLAYBACK_MIN_TICKS);
  });

  it("covers the mean gap, three standard deviations of it, and a frame", () => {
    // gaps of 35 and 65 ms: σ 15 (14.5 as the weighted variance sees it), so
    // (50 + 3 × 14.5 + 16.7) / 50 ticks
    expect(fed(400, (i) => (i % 2 === 0 ? 35 : 65)).targetTicks()).toBeCloseTo(2.2, 1);
  });

  it("asks for no more than the ceiling, and counts a gap as the ceiling at most", () => {
    expect(fed(60, (i) => (i % 2 === 0 ? 0 : 400)).targetTicks()).toBe(PLAYBACK_MAX_TICKS);
    // one 2 s gap weighs what a 300 ms one does
    const long = fed(100, (i) => (i === 50 ? 2000 : TICK_MS));
    const capped = fed(100, (i) => (i === 50 ? PLAYBACK_MAX_TICKS * TICK_MS : TICK_MS));
    expect(long.targetTicks()).toBe(capped.targetTicks());
  });

  it("leaves out the gap before an arrival it was told to forget (an outage)", () => {
    const told = fed(100, () => TICK_MS);
    told.forgetArrival();
    told.observe(100 * TICK_MS + 3000);
    expect(told.targetTicks()).toBe(PLAYBACK_MIN_TICKS);
    const untold = fed(100, () => TICK_MS);
    untold.observe(100 * TICK_MS + 3000);
    expect(untold.targetTicks()).toBeGreaterThan(PLAYBACK_MIN_TICKS);
  });

  it("counts a frame as 250 ms at most", () => {
    const hitch = fed(100, () => TICK_MS);
    hitch.frame(5000);
    const capped = fed(100, () => TICK_MS);
    capped.frame(250);
    expect(hitch.targetTicks()).toBe(capped.targetTicks());
  });

  it("runs the render clock 5% fast or slow past 5 ms from the target, and at 1 within it", () => {
    const delay = fed(100, () => TICK_MS);
    const at = (ms: number): number => delay.rate(PLAYBACK_MIN_TICKS + ms / TICK_MS);
    expect(at(6)).toBe(1 + PLAYBACK_WARP);
    expect(at(-6)).toBe(1 - PLAYBACK_WARP);
    expect(at(4)).toBe(1);
    expect(at(-4)).toBe(1);
  });
});

describe("WorldClock's render timeline", () => {
  /**
   * A client at 60 fps: snapshots sent every 50 ms from tick 1000 arrive
   * 40 ms later (plus `jitter()` ms), unless a stall holds them; `stamped`
   * false sends them without `t` (the H1 fallback).
   */
  function client(jitter: () => number = () => 0, stamped = true) {
    const clock = new WorldClock(20);
    let now = 10_000;
    let tick = 1000;
    let latest = 0;
    let nextSend = now - 40;
    let held: { tick: number; sendT: number; at: number }[] = [];
    const step = (frames: number, deliver = true): void => {
      for (let f = 0; f < frames; f++) {
        now += FRAME_MS;
        while (nextSend + 40 <= now) {
          held.push({ tick, sendT: nextSend, at: nextSend + 40 + jitter() });
          tick++;
          nextSend += TICK_MS;
        }
        if (deliver) {
          const frameAt = now;
          const due = held.filter((snap) => snap.at <= frameAt);
          held = held.filter((snap) => snap.at > frameAt);
          for (const snap of due) {
            clock.observe(snap.tick, stamped ? snap.sendT : undefined, now);
            latest = Math.max(latest, snap.tick);
          }
        }
        clock.advance(FRAME_MS / 1000, now);
      }
    };
    /** The render tick's advance over each of `frames` frames. */
    const advances = (frames: number, deliver = true): number[] => {
      const out: number[] = [];
      for (let f = 0; f < frames; f++) {
        const before = clock.renderTick() ?? 0;
        step(1, deliver);
        out.push((clock.renderTick() ?? 0) - before);
      }
      return out;
    };
    /** A reconnect: what the outage held never arrives (the stream does not replay it). */
    const drop = (): void => {
      held = [];
    };
    return { clock, step, advances, drop, latest: () => latest };
  }

  /** Within the dead band (5 ms) of the floor, or `slack` ticks. */
  const atFloor = (delay: number | null, slack = 0.1): boolean =>
    Math.abs((delay ?? 0) - PLAYBACK_MIN_TICKS) <= slack + 1e-6;

  it("converges on the floor without a jump", () => {
    const { clock, step, advances } = client();
    step(1);
    for (const advance of advances(1200)) {
      expect(advance).toBeGreaterThanOrEqual(0);
      expect(advance).toBeLessThanOrEqual(FASTEST_FRAME_TICKS);
    }
    expect(atFloor(clock.delayTicks())).toBe(true);
  });

  it("never renders more than two ticks past the newest tick it saw, though arrivals wobble", () => {
    const rng = mulberry32(3);
    const { clock, step, latest } = client(() => rng() * 30);
    for (let f = 0; f < 1200; f++) {
      step(1);
      expect(clock.renderTick() ?? 0).toBeLessThanOrEqual(latest() + PLAYBACK_MAX_AHEAD_TICKS);
    }
  });

  it("holds two ticks past the newest through a 250 ms stall, then gives the delay it grew back at the warp's pace", () => {
    const { clock, step, advances, latest } = client();
    step(1200);
    const before = clock.delayTicks() ?? 0;
    // 250 ms with nothing delivered: the render clock stops two ticks past the newest
    step(15, false);
    expect(clock.renderTick()).toBeCloseTo(latest() + PLAYBACK_MAX_AHEAD_TICKS, 6);
    expect(clock.delayTicks()).toBeGreaterThan(before + 1);
    // the held snapshots arrive at once; the render clock resumes, never jumping
    for (const advance of advances(60)) {
      expect(advance).toBeGreaterThanOrEqual(0);
      expect(advance).toBeLessThanOrEqual(FASTEST_FRAME_TICKS);
    }
    // once the stall leaves the estimate (its 10 s memory), the delay is back at the floor
    step(1800);
    expect(atFloor(clock.delayTicks())).toBe(true);
  });

  it("gives a 500 ms stall's delay back at the warp's pace, a tick a second", () => {
    const { clock, step } = client();
    step(1200);
    step(30, false);
    step(1);
    const grown = clock.delayTicks() ?? 0;
    step(60);
    const given = grown - (clock.delayTicks() ?? 0);
    expect(given).toBeGreaterThan(0.9);
    expect(given).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("resumes a 3 s stall at most twice the ceiling behind", () => {
    const { clock, step } = client();
    step(600);
    step(180, false);
    step(1);
    // capped against the estimate before the frame's advance
    expect(clock.delayTicks()).toBeLessThanOrEqual(PLAYBACK_MAX_LAG_TICKS + FASTEST_FRAME_TICKS);
  });

  it("starts the render timeline again on a hello from the same server, and forgets it on another's", () => {
    const { clock, step, drop } = client();
    clock.followServer("one");
    step(600);
    // a 3 s outage, then the same server's hello: the fixed delay again
    step(180, false);
    drop();
    clock.followServer("one");
    step(1);
    expect(clock.delayTicks()).toBeLessThanOrEqual(PLAYBACK_START_TICKS + FASTEST_FRAME_TICKS);
    step(600);
    expect(atFloor(clock.delayTicks())).toBe(true);
    clock.followServer("two");
    expect(clock.renderTick()).toBeNull();
  });

  it("renders near the floor from arrivals alone when snapshots carry no send time", () => {
    const { clock, step } = client(() => 0, false);
    step(1800);
    // the H1 estimate moves in nudges at each arrival, so the delay sits at the band's edge
    expect(atFloor(clock.delayTicks(), 0.15)).toBe(true);
  });
});
