/**
 * Ground-truth recorder — captures the authoritative per-tick world state
 * straight from the GameLoop's onTick hook. No socket in the way, so this
 * is exact: positions, tick duration, and snapshot payload size per tick,
 * plus deaths (used to mask legitimate teleports in the metrics), and the
 * food the world held after each of the last FOOD_TAIL_TICKS ticks (to check
 * the clients' against).
 */

import type { ServerTrace } from "@project/bench";
import type { FoodDTO, GameLoopDeps, WorldSnapshot } from "@project/shared";

/**
 * Ticks of the server's food the trace keeps (10 s): a client's latest
 * snapshot is a trip behind the server's tick, and the run stops the loop
 * right after the clients.
 */
const FOOD_TAIL_TICKS = 200;

export interface GroundTruthRecorder {
  onTick: NonNullable<GameLoopDeps["onTick"]>;
  /** The world's food before the first tick (its keyframe), which each tick's change then moves. */
  seedFood(keyframe: WorldSnapshot): void;
  trace(): ServerTrace;
  reset(): void;
}

export function createGroundTruthRecorder(): GroundTruthRecorder {
  let trace: ServerTrace = { ticks: [], deaths: [], food: [] };
  const food = new Map<string, FoodDTO>();

  return {
    seedFood: (keyframe) => {
      food.clear();
      for (const item of keyframe.food?.[0]?.spawned ?? []) food.set(item.id, item);
    },
    onTick: (result, stats) => {
      for (const item of result.food?.spawned ?? []) food.set(item.id, item);
      for (const id of result.food?.eaten ?? []) food.delete(id);
      const tail = trace.food ?? [];
      tail.push({ tick: stats.tick, ids: [...food.keys()].sort() });
      if (tail.length > FOOD_TAIL_TICKS) tail.shift();
      trace.food = tail;
      trace.ticks.push({
        tick: stats.tick,
        tWall: stats.tWall,
        tickDurMs: stats.tickDurMs,
        snapshotBytes: stats.snapshotBytes,
        players: result.snapshot.players.map((p) => ({ id: p.id, x: p.x, y: p.y, ack: p.ack })),
        inputs: Object.entries(result.inputs).map(([id, entry]) => ({
          id,
          stepped: entry.stepped,
          depth: entry.depth,
        })),
      });
      for (const death of result.deaths) {
        trace.deaths.push({ tick: stats.tick, tWall: stats.tWall, id: death.id });
      }
    },
    trace: () => trace,
    reset: () => {
      trace = { ticks: [], deaths: [], food: [] };
    },
  };
}
