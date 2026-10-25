/**
 * Input-queue health: what the server sees of each client's clock. A client
 * whose frames arrive one a tick keeps the queue empty after each take; a
 * starved tick (no frame: the snake coasted) or a catch-up (two or more) is
 * jitter or a clock running slow or fast, and a queue that grows over the run
 * is one ratcheting toward its cap. And the ack must count the steps: a tick
 * where it moved by anything else is a movement step the client's replay
 * did not predict, a 9 px correction it shows as a surge or a stall.
 */

import type { ClientTrace, InputQueueReport, ServerTick } from "../types.js";
import { computeStats } from "./tracks.js";

/** The window's first and last stretch the depth trend compares. */
const TREND_SPAN_MS = 10_000;

/**
 * Counts the ticks where a snake's ack moved by other than the steps it took
 * (one for a coast), over consecutive fed ticks: each is a movement step its
 * client's replay did not predict.
 */
class MismatchCounter {
  public count = 0;
  /** every fed tick named the snake's ack (traces from before the check do not) */
  public known = true;
  private readonly last = new Map<string, { tick: number; ack: number }>();

  /**
   * A fed snake's tick: `player` is its entry in the tick's snapshot, or
   * undefined when the snapshot left it out (it died on that tick).
   */
  public note(
    id: string,
    tick: number,
    stepped: number,
    player: { ack?: number } | undefined,
  ): void {
    if (player === undefined) return;
    if (player.ack === undefined) {
      this.known = false;
      return;
    }
    const previous = this.last.get(id);
    this.last.set(id, { tick, ack: player.ack });
    // the tick before counts only when the snake was fed on it too
    if (previous === undefined || previous.tick !== tick - 1) return;
    if (player.ack - previous.ack !== (stepped === 0 ? 1 : stepped)) this.count++;
  }
}

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
  const mismatch = new MismatchCounter();
  const head = { sum: 0, n: 0 };
  const tail = { sum: 0, n: 0 };
  for (const tick of ticks) {
    const players = new Map(tick.players.map((p) => [p.id, p]));
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
      mismatch.note(entry.id, tick.tick, entry.stepped, players.get(entry.id));
    }
  }
  if (depths.length === 0) return undefined;
  const mean = (span: { sum: number; n: number }) => (span.n > 0 ? span.sum / span.n : 0);
  // fed snake-ticks as minutes, at the window's own tick period
  const tickMs = ticks.length > 1 ? (last.tWall - first.tWall) / (ticks.length - 1) : 0;
  const minutes = (depths.length * tickMs) / 60_000;
  return {
    depthP95: computeStats(depths).p95,
    starvedRate: starved / depths.length,
    multiStepRate: multiStep / depths.length,
    depthTrend: mean(tail) - mean(head),
    ...(mismatch.known
      ? { stepAckMismatchPerMin: minutes > 0 ? mismatch.count / minutes : 0 }
      : {}),
  };
}

/**
 * One client's own snake's input queue over `ticks` (already windowed), and
 * the half-tick nudges of its frame clock a minute within them when its
 * trace records them; undefined for a spectator.
 */
export function computeOwnQueue(
  ticks: ServerTick[],
  client: ClientTrace,
): InputQueueReport | undefined {
  if (!client.playerId) return undefined;
  const report = computeInputQueue(ticks, client.playerId);
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (!report || !client.nudges || !first || !last) return report;
  // a minute of the snake's fed ticks, as stepAckMismatchPerMin counts it
  const playerId = client.playerId;
  const fed = ticks.filter((t) => t.inputs.some((e) => e.id === playerId)).length;
  const tickMs = ticks.length > 1 ? (last.tWall - first.tWall) / (ticks.length - 1) : 0;
  const minutes = (fed * tickMs) / 60_000;
  const nudges = client.nudges.filter((n) => n.tWall >= first.tWall && n.tWall <= last.tWall);
  return { ...report, nudgesPerMin: minutes > 0 ? nudges.length / minutes : 0 };
}
