/**
 * Ground-truth recorder — captures the authoritative per-tick world state
 * straight from the GameLoop's onTick hook. No socket in the way, so this
 * is exact: positions, tick duration, and snapshot payload size per tick,
 * plus deaths (used to mask legitimate teleports in the metrics).
 */

import type { ServerTrace } from "@project/bench";
import type { GameLoopDeps } from "../services/game/loop.js";

export interface GroundTruthRecorder {
  onTick: NonNullable<GameLoopDeps["onTick"]>;
  trace(): ServerTrace;
  reset(): void;
}

export function createGroundTruthRecorder(): GroundTruthRecorder {
  let trace: ServerTrace = { ticks: [], deaths: [] };

  return {
    onTick: (result, stats) => {
      trace.ticks.push({
        tick: stats.tick,
        tWall: stats.tWall,
        tickDurMs: stats.tickDurMs,
        snapshotBytes: stats.snapshotBytes,
        players: result.snapshot.players.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      });
      for (const death of result.deaths) {
        trace.deaths.push({ tick: stats.tick, tWall: stats.tWall, id: death.id });
      }
    },
    trace: () => trace,
    reset: () => {
      trace = { ticks: [], deaths: [] };
    },
  };
}
