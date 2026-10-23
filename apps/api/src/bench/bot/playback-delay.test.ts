import { mulberry32, normal } from "@project/bench";
import { describe, expect, it } from "vitest";
import {
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

  it("renders a link whose arrivals wobble by 15 ms over two ticks behind", () => {
    const rng = mulberry32(7);
    const target = fed(400, () => Math.max(0, TICK_MS + 15 * normal(rng))).targetTicks();
    // mean + 3σ + a frame: (50 + 45 + 17) / 50
    expect(target).toBeGreaterThan(1.9);
    expect(target).toBeLessThan(2.8);
  });

  it("asks for no more than the ceiling", () => {
    expect(fed(60, (i) => (i % 2 === 0 ? 0 : 400)).targetTicks()).toBe(PLAYBACK_MAX_TICKS);
  });

  it("runs the render clock 5% fast or slow toward the target, and not within 5 ms of it", () => {
    const delay = fed(100, () => TICK_MS);
    expect(delay.rate(3)).toBe(1 + PLAYBACK_WARP);
    expect(delay.rate(1)).toBe(1 - PLAYBACK_WARP);
    expect(delay.rate(PLAYBACK_MIN_TICKS + 0.05)).toBe(1);
  });
});

describe("WorldClock's render timeline", () => {
  /**
   * A client at 60 fps: snapshots sent every 50 ms from tick 1000 arrive
   * 40 ms later, unless a stall holds them.
   */
  function client() {
    const clock = new WorldClock(20);
    let now = 10_000;
    let tick = 1000;
    let nextSend = now - 40;
    let held: { tick: number; sendT: number }[] = [];
    const step = (frames: number, deliver = true): void => {
      for (let f = 0; f < frames; f++) {
        now += FRAME_MS;
        while (nextSend + 40 <= now) {
          held.push({ tick, sendT: nextSend });
          tick++;
          nextSend += TICK_MS;
        }
        if (deliver) {
          for (const snap of held) clock.observe(snap.tick, snap.sendT, now);
          held = [];
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
    return { clock, step, advances };
  }

  it("converges on the floor without a jump", () => {
    const { clock, step, advances } = client();
    step(1);
    for (const advance of advances(1200)) {
      expect(advance).toBeGreaterThanOrEqual(0);
      expect(advance).toBeLessThanOrEqual(FASTEST_FRAME_TICKS);
    }
    // within the dead band (5 ms) of the floor
    expect(Math.abs((clock.delayTicks() ?? 0) - PLAYBACK_MIN_TICKS)).toBeLessThanOrEqual(
      0.1 + 1e-6,
    );
  });

  it("holds at the newest tick through a 250 ms stall, then gives the delay it grew back at the warp's pace", () => {
    const { clock, step, advances } = client();
    step(1200);
    const before = clock.delayTicks() ?? 0;
    // 250 ms with nothing delivered: the render clock stops at the newest tick
    step(15, false);
    const grown = clock.delayTicks() ?? 0;
    expect(grown).toBeGreaterThan(before + 3);
    // the held snapshots arrive at once; the render clock resumes, never jumping
    for (const advance of advances(60)) {
      expect(advance).toBeGreaterThanOrEqual(0);
      expect(advance).toBeLessThanOrEqual(FASTEST_FRAME_TICKS);
    }
    // a second at 5% fast gives back a tick at most
    expect(grown - (clock.delayTicks() ?? 0)).toBeLessThanOrEqual(1 + 1e-6);
    // once the stall leaves the estimate, the delay is back at the floor
    step(600);
    expect(Math.abs((clock.delayTicks() ?? 0) - PLAYBACK_MIN_TICKS)).toBeLessThanOrEqual(
      0.1 + 1e-6,
    );
  });
});
