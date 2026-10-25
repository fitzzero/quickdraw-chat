/**
 * FoodTracker — 1:1 TS port of the Godot client's food (main.gd
 * `_apply_food`, `_on_keyframe` and `_request_keyframe`, food_layer.gd
 * `apply_deltas`): the food a client holds, kept from the world stream.
 *
 * Every snapshot repeats the food changes of the GAME_FOOD_WINDOW ticks up
 * to its own, so a client applies each tick's change once, in tick order,
 * and a dropped snapshot costs nothing. A snapshot more than the window
 * past the last one applied means changes were lost: the client asks for a
 * keyframe (it subscribes to the stream again), and the keyframe, the
 * stream's seed, replaces what it holds. The bots ignore the food of the
 * bootstrap that watchWorld or joinGame answers, which main.gd's
 * `_on_world_ready` applies as a keyframe.
 */

import type { FoodDTO, WorldSnapshot } from "../../types/game.js";
import { GAME_FOOD_WINDOW } from "../../types/game.js";

export class FoodTracker {
  private readonly food = new Map<string, FoodDTO>();
  /** The tick whose food changes this holds, every one before it too (-1 before a keyframe). */
  public tick = -1;
  /** A keyframe was asked for and has not arrived. */
  public awaitingKeyframe = false;
  /** Keyframes asked for: after a gap, or for players the snapshots could not name. */
  public resyncs = 0;

  /**
   * Applies a snapshot's food. Returns true when the client must ask for a
   * keyframe (subscribe to the world stream again).
   */
  public apply(snapshot: WorldSnapshot): boolean {
    if (this.tick >= 0 && snapshot.tick - this.tick > GAME_FOOD_WINDOW) return this.askKeyframe();
    for (const entry of snapshot.food ?? []) {
      if (entry.tick <= this.tick) continue;
      for (const item of entry.spawned ?? []) this.food.set(item.id, item);
      for (const id of entry.eaten ?? []) this.food.delete(id);
    }
    this.tick = Math.max(this.tick, snapshot.tick);
    return false;
  }

  /**
   * A keyframe (the stream's seed) replaces the food, all of it in one entry
   * at the keyframe's tick. It may be older than snapshots applied already:
   * the next snapshot's window applies the changes after it again.
   */
  public keyframe(keyframe: WorldSnapshot): void {
    this.food.clear();
    for (const item of keyframe.food?.[0]?.spawned ?? []) this.food.set(item.id, item);
    this.tick = keyframe.tick;
    this.awaitingKeyframe = false;
  }

  /**
   * The client needs a keyframe (a gap, or a player the snapshots name by
   * an introduction it missed). Returns true when it must ask for one: none
   * is on its way.
   */
  public askKeyframe(): boolean {
    if (this.awaitingKeyframe) return false;
    this.awaitingKeyframe = true;
    this.resyncs += 1;
    return true;
  }

  /** The keyframe request ended, its seed applied if one came: the next snapshot past the window asks again. */
  public resyncEnded(): void {
    this.awaitingKeyframe = false;
  }

  /** The ids of the food held, sorted. */
  public ids(): string[] {
    return [...this.food.keys()].sort();
  }
}
