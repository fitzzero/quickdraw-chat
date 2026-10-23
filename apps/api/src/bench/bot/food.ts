/**
 * FoodTracker — 1:1 TS port of the Godot client's food (main.gd
 * `_apply_food`, food_layer.gd `apply_deltas`): the food a client holds,
 * kept from the world stream.
 *
 * Every snapshot repeats the food changes of the GAME_FOOD_WINDOW ticks up
 * to its own, so a client applies each tick's change once, in tick order,
 * and a dropped snapshot costs nothing. A snapshot more than the window
 * past the last one applied means changes were lost: the client asks for a
 * keyframe (it subscribes to the stream again), and the keyframe, the seed
 * without a send time `t`, replaces what it holds.
 */

import type { FoodDTO, WorldSnapshot } from "@project/shared";
import { GAME_FOOD_WINDOW } from "@project/shared";

export class FoodTracker {
  private readonly food = new Map<string, FoodDTO>();
  /** The tick whose food changes this holds, every one before it too (-1 before a keyframe). */
  public tick = -1;
  /** A keyframe was asked for and has not arrived. */
  public awaitingKeyframe = false;
  /** Keyframes asked for after a gap. */
  public resyncs = 0;

  /**
   * Applies a snapshot's food. Returns true when the client must ask for a
   * keyframe (subscribe to the world stream again).
   */
  public apply(snapshot: WorldSnapshot): boolean {
    const entries = snapshot.food ?? [];
    if (snapshot.t === undefined) {
      this.food.clear();
      for (const item of entries[0]?.spawned ?? []) this.food.set(item.id, item);
      this.tick = snapshot.tick;
      this.awaitingKeyframe = false;
      return false;
    }
    if (this.tick >= 0 && snapshot.tick - this.tick > GAME_FOOD_WINDOW) {
      if (this.awaitingKeyframe) return false;
      this.awaitingKeyframe = true;
      this.resyncs += 1;
      return true;
    }
    for (const entry of entries) {
      if (entry.tick <= this.tick) continue;
      for (const item of entry.spawned ?? []) this.food.set(item.id, item);
      for (const id of entry.eaten ?? []) this.food.delete(id);
    }
    this.tick = Math.max(this.tick, snapshot.tick);
    return false;
  }

  /** A keyframe request failed: the next snapshot past the window asks again. */
  public keyframeRefused(): void {
    this.awaitingKeyframe = false;
  }

  /** The ids of the food held, sorted. */
  public ids(): string[] {
    return [...this.food.keys()].sort();
  }
}
