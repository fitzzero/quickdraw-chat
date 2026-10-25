import type { FoodDelta, FoodDTO, WorldSnapshot } from "../../types/game.js";
import { GAME_FOOD_WINDOW } from "../../types/game.js";
import { describe, expect, it } from "vitest";
import { FoodTracker } from "./food.js";

const item = (id: string): FoodDTO => ({ id, x: 0, y: 0, v: 1 });

/** A tick's snapshot, carrying the window's food entries. */
function snap(tick: number, food: FoodDelta[] = []): WorldSnapshot {
  return { tick, t: tick * 50, players: [], ...(food.length > 0 ? { food } : {}) };
}

/** A keyframe: the seed, all the food in one entry at its tick. */
function keyframe(tick: number, ids: string[]): WorldSnapshot {
  return { tick, players: [], food: [{ tick, spawned: ids.map(item) }] };
}

describe("FoodTracker", () => {
  it("replaces its food with a keyframe", () => {
    const food = new FoodTracker();
    food.keyframe(keyframe(10, ["a", "b"]));
    food.apply(snap(11, [{ tick: 11, spawned: [item("c")] }]));
    food.keyframe(keyframe(12, ["d"]));
    expect(food.ids()).toEqual(["d"]);
    expect(food.tick).toBe(12);
  });

  it("applies each tick's change once, though the window repeats it", () => {
    const food = new FoodTracker();
    food.keyframe(keyframe(10, ["a"]));
    const spawned: FoodDelta = { tick: 11, spawned: [item("b")] };
    const eaten: FoodDelta = { tick: 12, eaten: ["b"] };
    food.apply(snap(11, [spawned]));
    food.apply(snap(12, [spawned, eaten]));
    // tick 11's spawn comes again in tick 13's snapshot: b stays eaten
    food.apply(snap(13, [spawned, eaten]));
    expect(food.ids()).toEqual(["a"]);
  });

  it("loses nothing to snapshots dropped inside the window", () => {
    const food = new FoodTracker();
    food.keyframe(keyframe(10, ["a"]));
    const window: FoodDelta[] = [
      { tick: 11, spawned: [item("b")] },
      { tick: 13, eaten: ["a"] },
      { tick: 15, spawned: [item("c")] },
    ];
    // ticks 11 to 15 were dropped; tick 16's snapshot repeats their changes
    expect(food.apply(snap(10 + GAME_FOOD_WINDOW, window))).toBe(false);
    expect(food.ids()).toEqual(["b", "c"]);
    expect(food.resyncs).toBe(0);
  });

  it("asks for one keyframe past the window, and again once the request ended without one", () => {
    const food = new FoodTracker();
    food.keyframe(keyframe(10, ["a"]));
    const past = 10 + GAME_FOOD_WINDOW + 1;
    expect(food.apply(snap(past, [{ tick: past, eaten: ["a"] }]))).toBe(true);
    // the changes after tick 10 are incomplete: nothing applies until the keyframe
    expect(food.ids()).toEqual(["a"]);
    expect(food.apply(snap(past + 1))).toBe(false);
    // the stream answered no seed (or the request failed)
    food.resyncEnded();
    expect(food.apply(snap(past + 2))).toBe(true);
    expect(food.resyncs).toBe(2);
    food.keyframe(keyframe(past + 2, ["b"]));
    expect(food.awaitingKeyframe).toBe(false);
    expect(food.apply(snap(past + 3))).toBe(false);
    expect(food.ids()).toEqual(["b"]);
  });

  it("takes a keyframe older than the snapshots it applied, and the next window catches it up", () => {
    const food = new FoodTracker();
    food.keyframe(keyframe(10, ["a"]));
    const spawned: FoodDelta = { tick: 12, spawned: [item("b")] };
    const eaten: FoodDelta = { tick: 13, eaten: ["a"] };
    food.apply(snap(12, [spawned]));
    food.apply(snap(13, [spawned, eaten]));
    // the keyframe of tick 11, handled after snapshots 12 and 13
    food.keyframe(keyframe(11, ["a"]));
    expect(food.tick).toBe(11);
    food.apply(snap(14, [spawned, eaten]));
    expect(food.ids()).toEqual(["b"]);
    expect(food.tick).toBe(14);
  });

  it("applies snapshots that come before the first keyframe, which then replaces them", () => {
    const food = new FoodTracker();
    expect(food.apply(snap(40, [{ tick: 40, spawned: [item("x")] }]))).toBe(false);
    expect(food.ids()).toEqual(["x"]);
    food.keyframe(keyframe(39, ["a", "x"]));
    food.apply(snap(41, [{ tick: 40, spawned: [item("x")] }]));
    expect(food.ids()).toEqual(["a", "x"]);
  });
});
