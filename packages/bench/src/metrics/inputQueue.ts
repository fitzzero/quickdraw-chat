/**
 * Input-queue health: what the server sees of each client's clock. A client
 * whose frames arrive one a tick keeps the queue empty after each take; a
 * starved tick (no frame: the snake coasted) or a catch-up (two or more) is
 * jitter or a clock running slow or fast, and a queue that grows over the run
 * is one ratcheting toward its cap.
 */

import type { InputQueueReport, ServerTick } from "../types.js";
import { computeStats } from "./tracks.js";

/** The window's first and last stretch the depth trend compares. */
const TREND_SPAN_MS = 10_000;

/**
 * The input queue over `ticks` (already windowed), for one player or, without
 * `playerId`, every human snake; undefined when no tick holds one.
 */
export function computeInputQueue(
  ticks: ServerTick[],
  playerId?: string,
): InputQueueReport | undefined {
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (!first || !last) return undefined;
  const headEnd = first.tWall + TREND_SPAN_MS;
  const tailStart = last.tWall - TREND_SPAN_MS;

  const depths: number[] = [];
  let starved = 0;
  let multiStep = 0;
  const head = { sum: 0, n: 0 };
  const tail = { sum: 0, n: 0 };
  for (const tick of ticks) {
    for (const entry of tick.inputs) {
      if (playerId !== undefined && entry.id !== playerId) continue;
      depths.push(entry.depth);
      if (entry.stepped === 0) starved++;
      if (entry.stepped >= 2) multiStep++;
      if (tick.tWall <= headEnd) {
        head.sum += entry.depth;
        head.n++;
      }
      if (tick.tWall >= tailStart) {
        tail.sum += entry.depth;
        tail.n++;
      }
    }
  }
  if (depths.length === 0) return undefined;
  const mean = (span: { sum: number; n: number }) => (span.n > 0 ? span.sum / span.n : 0);
  return {
    depthP95: computeStats(depths).p95,
    starvedRate: starved / depths.length,
    multiStepRate: multiStep / depths.length,
    depthTrend: mean(tail) - mean(head),
  };
}
