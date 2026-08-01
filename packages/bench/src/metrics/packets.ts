/**
 * Packet-health metrics. Snapshot ticks are numbered by the server, so
 * volatile drops are exactly measurable from the tick deltas between
 * consecutive arrivals — regardless of whether the drop happened in
 * engine.io's write buffer (backpressure) or a snapshot was coalesced.
 */

import type { ClientTrace, PacketHealth } from "../types.js";
import { computeStats } from "./tracks.js";

export function computePacketHealth(
  client: ClientTrace,
  windowStart: number,
  windowEnd: number,
): PacketHealth {
  const snaps = client.snapshots.filter((s) => s.tWall >= windowStart && s.tWall <= windowEnd);

  const interArrivals: number[] = [];
  let missedSum = 0;
  let deltaSum = 0;
  let maxMissed = 0;
  for (let i = 1; i < snaps.length; i++) {
    const cur = snaps[i];
    const before = snaps[i - 1];
    if (!cur || !before) continue;
    interArrivals.push(cur.tWall - before.tWall);
    const tickDelta = cur.tick - before.tick;
    if (tickDelta >= 1) {
      missedSum += tickDelta - 1;
      deltaSum += tickDelta;
      maxMissed = Math.max(maxMissed, tickDelta - 1);
    }
  }

  const seconds = (windowEnd - windowStart) / 1000;
  const acked = client.inputs.filter(
    (i) => i.tAcked !== undefined && i.tSent >= windowStart && i.tSent <= windowEnd,
  );

  return {
    interArrivalMs: computeStats(interArrivals),
    effectiveRate: seconds > 0 ? snaps.length / seconds : 0,
    gapRate: deltaSum > 0 ? missedSum / deltaSum : 0,
    maxConsecutiveMissedTicks: maxMissed,
    inputAckRttMs: computeStats(acked.map((i) => (i.tAcked ?? 0) - i.tSent)),
  };
}
