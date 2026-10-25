/**
 * The remote interpolator at the two ticks a client may ask it for: the
 * playback timeline between two snapshots, and the present, which no
 * snapshot has reached (dead reckoning from the newest, the extrapolation
 * budget, the coast past it, and the glide that folds a new snapshot's
 * jump into the drawn head instead of a pop).
 */

import { describe, expect, it } from "vitest";
import type { PlayerSnap } from "../../types/game.js";
import { MAX_EXTRAPOLATION_TICKS, RemoteInterpolator } from "./interpolation.js";

const TUNABLES = { baseSpeed: 180, boostSpeed: 300 };
const TICK_RATE = 20;
const TICK_S = 1 / TICK_RATE;
const FRAME_S = 1 / 60;

function snap(x: number, y: number, boost = false): PlayerSnap {
  return { id: "r", x, y, dx: 1, dy: 0, len: 10, boost, ack: 0 };
}

/** Renders frame by frame from `from` to `to` ticks, as a client does; the last position. */
function rendered(interp: RemoteInterpolator, from: number, to: number): { x: number; y: number } {
  let at = { x: 0, y: 0 };
  for (let tick = from; tick <= to; tick += FRAME_S * TICK_RATE) {
    at = interp.renderFrame(tick, FRAME_S) ?? at;
  }
  return at;
}

describe("RemoteInterpolator", () => {
  it("on the playback timeline, interpolates between the snapshots that bracket the tick", () => {
    const interp = new RemoteInterpolator(TUNABLES, TICK_RATE);
    interp.pushSnap(100, snap(0, 0));
    interp.pushSnap(101, snap(9, 0));
    expect(interp.renderFrame(100.5, FRAME_S)).toEqual({ x: 4.5, y: 0 });
  });

  it("at the present, advances the newest snapshot along its heading at its speed, by the estimate's lead", () => {
    const interp = new RemoteInterpolator(TUNABLES, TICK_RATE);
    interp.pushSnap(100, snap(0, 0));
    const lead = 1.5;
    const at = interp.renderFrame(100 + lead, FRAME_S);
    expect(at?.x).toBeCloseTo(TUNABLES.baseSpeed * TICK_S * lead, 6);
    expect(at?.y).toBe(0);
    // boost picks the speed
    const boosted = new RemoteInterpolator(TUNABLES, TICK_RATE);
    boosted.pushSnap(100, snap(0, 0, true));
    expect(boosted.renderFrame(100 + lead, FRAME_S)?.x).toBeCloseTo(
      TUNABLES.boostSpeed * TICK_S * lead,
      6,
    );
  });

  it("holds past the budget: beyond MAX_EXTRAPOLATION_TICKS the remote coasts to a stop", () => {
    const interp = new RemoteInterpolator(TUNABLES, TICK_RATE);
    interp.pushSnap(100, snap(0, 0));
    const budget = rendered(interp, 100, 100 + MAX_EXTRAPOLATION_TICKS);
    expect(budget.x).toBeCloseTo(TUNABLES.baseSpeed * TICK_S * MAX_EXTRAPOLATION_TICKS, 1);
    const coasted = rendered(interp, 100 + MAX_EXTRAPOLATION_TICKS, 110);
    // the coast adds less than the budget again, then nothing
    expect(coasted.x).toBeGreaterThan(budget.x);
    expect(coasted.x - budget.x).toBeLessThan(budget.x);
    const held = rendered(interp, 110, 120);
    expect(held.x).toBeCloseTo(coasted.x, 3);
  });

  it("glides on a snapshot's arrival: one off the extrapolation moves the drawn head over a tenth of a second, not at once", () => {
    const interp = new RemoteInterpolator(TUNABLES, TICK_RATE);
    interp.pushSnap(100, snap(0, 0));
    const before = interp.renderFrame(101.5, FRAME_S);
    // the snake turned: the next snapshot is 40 px off where the heading put it
    interp.pushSnap(101, snap(9, 40));
    const first = interp.renderFrame(101.5 + FRAME_S * TICK_RATE, FRAME_S);
    expect(first).not.toBeNull();
    expect(before).not.toBeNull();
    if (first === null || before === null) return;
    // the first frame after the arrival moves a frame's worth, not the whole 40 px
    expect(Math.hypot(first.x - before.x, first.y - before.y)).toBeLessThan(15);
    // a second later the head is where the snapshots put it (an interpolator
    // with no history renders the raw target)
    const settled = rendered(interp, 101.5 + 2 * FRAME_S * TICK_RATE, 121.5);
    const fresh = new RemoteInterpolator(TUNABLES, TICK_RATE);
    fresh.pushSnap(100, snap(0, 0));
    fresh.pushSnap(101, snap(9, 40));
    const target = fresh.renderFrame(121.5, FRAME_S);
    expect(target).not.toBeNull();
    if (target === null) return;
    expect(Math.hypot(settled.x - target.x, settled.y - target.y)).toBeLessThan(0.5);
  });

  it("folds nothing while the target moves on: motion between frames is continuity, not a jump", () => {
    const interp = new RemoteInterpolator(TUNABLES, TICK_RATE);
    interp.pushSnap(100, snap(0, 0));
    interp.pushSnap(101, snap(9, 0));
    interp.pushSnap(102, snap(18, 0));
    // on the playback timeline, through a bracket boundary
    const drawn: number[] = [];
    for (let tick = 100.2; tick <= 101.8; tick += FRAME_S * TICK_RATE) {
      drawn.push(interp.renderFrame(tick, FRAME_S)?.x ?? -1);
    }
    for (let i = 1; i < drawn.length; i++) {
      // every frame a frame's worth of motion, nothing held back
      expect((drawn[i] ?? 0) - (drawn[i - 1] ?? 0)).toBeCloseTo(9 * FRAME_S * TICK_RATE, 3);
    }
  });
});
