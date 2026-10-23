import type { FoodDelta, FoodDTO, WorldSnapshot } from "@project/shared";
import { GAME_FOOD_WINDOW } from "@project/shared";
import { describe, expect, it } from "vitest";
import { FoodTracker } from "./food.js";

const item = (id: string): FoodDTO => ({ id, x: 0, y: 0, v: 1 });

/** A tick's snapshot, carrying the window's food entries. */
function snap(tick: number, food: FoodDelta[] = []): WorldSnapshot {
  return { tick, t: tick * 50, players: [], ...(food.length > 0 ? { food } : {}) };
}

/** A keyframe: the seed, without a send time, all the food in one entry. */
function keyframe(tick: number, ids: string[]): WorldSnapshot {
  return { tick, players: [], food: [{ tick, spawned: ids.map(item) }] };
}

describe("FoodTracker", () => {
  it("replaces its food with a keyframe", () => {
    const food = new FoodTracker();
    food.apply(keyframe(10, ["a", "b"]));
    food.apply(snap(11, [{ tick: 11, spawned: [item("c")] }]));
    expect(food.apply(keyframe(12, ["d"]))).toBe(false);
    expect(food.ids()).toEqual(["d"]);
    expect(food.tick).toBe(12);
  });

  it("applies each tick's change once, though the window repeats it", () => {
    const food = new FoodTracker();
    food.apply(keyframe(10, ["a"]));
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
    food.apply(keyframe(10, ["a"]));
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

  it("asks for one keyframe past the window, and again after a refusal", () => {
    const food = new FoodTracker();
    food.apply(keyframe(10, ["a"]));
    const past = 10 + GAME_FOOD_WINDOW + 1;
    expect(food.apply(snap(past, [{ tick: past, eaten: ["a"] }]))).toBe(true);
    // the changes after tick 10 are incomplete: nothing applies until the keyframe
    expect(food.ids()).toEqual(["a"]);
    expect(food.apply(snap(past + 1))).toBe(false);
    food.keyframeRefused();
    expect(food.apply(snap(past + 2))).toBe(true);
    expect(food.resyncs).toBe(2);
    food.apply(keyframe(past + 2, ["b"]));
    expect(food.awaitingKeyframe).toBe(false);
    expect(food.apply(snap(past + 3))).toBe(false);
    expect(food.ids()).toEqual(["b"]);
  });
});
