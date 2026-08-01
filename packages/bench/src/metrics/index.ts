/**
 * Scorecard computation: one run's traces → one Scorecard, plus median-of-N
 * aggregation across repeated runs of the same scenario.
 */

import type { ClientReport, RunTraces, Scenario, Scorecard } from "../types.js";
import { computeDivergence, computeFidelity } from "./divergence.js";
import { computePacketHealth } from "./packets.js";
import { computeSmoothness } from "./smoothness.js";
import { computeStats } from "./tracks.js";

export interface ScorecardMeta {
  tier: 1 | 2;
  gitCommit: string;
  branch: string;
  label?: string;
}

export function computeScorecard(
  traces: RunTraces,
  scenario: Scenario,
  meta: ScorecardMeta,
): Scorecard {
  const ticks = traces.server.ticks;
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (!first || !last) throw new Error("computeScorecard: empty server trace");
  const windowStart = first.tWall + scenario.warmupMs;
  const windowEnd = last.tWall;
  const windowed = ticks.filter((t) => t.tWall >= windowStart);

  // Entity ids on the wire are user cuids; report them as bot names
  const nameByPlayerId = new Map<string, string>();
  for (const client of traces.clients) {
    if (client.playerId) nameByPlayerId.set(client.playerId, client.clientId);
  }
  const friendly = (entityId: string) => nameByPlayerId.get(entityId) ?? entityId;

  const clients: Record<string, ClientReport> = {};
  for (const client of traces.clients) {
    const fidelity = computeFidelity(client, traces.server, windowStart, windowEnd);
    fidelity.perEntity = Object.fromEntries(
      Object.entries(fidelity.perEntity).map(([id, v]) => [friendly(id), v]),
    );
    const frames = client.frames.filter((f) => f.tWall >= windowStart && f.tWall <= windowEnd);
    clients[client.clientId] = {
      kind: client.kind,
      packet: computePacketHealth(client, windowStart, windowEnd),
      smoothness: computeSmoothness(client, traces.server, windowStart, windowEnd),
      perEntity: fidelity.perEntity,
      ...(fidelity.predictionErrorPx ? { predictionErrorPx: fidelity.predictionErrorPx } : {}),
      effectiveFps:
        windowEnd > windowStart ? frames.length / ((windowEnd - windowStart) / 1000) : 0,
    };
  }

  return {
    schemaVersion: 1,
    scenario: scenario.name,
    seed: scenario.seed,
    tier: meta.tier,
    gitCommit: meta.gitCommit,
    branch: meta.branch,
    ...(meta.label ? { label: meta.label } : {}),
    createdAt: new Date().toISOString(),
    durationMs: windowEnd - windowStart,
    runs: 1,
    server: {
      tickDurMs: computeStats(windowed.map((t) => t.tickDurMs)),
      snapshotBytes: computeStats(windowed.map((t) => t.snapshotBytes)),
      effectiveTickRate:
        windowEnd > windowStart ? windowed.length / ((windowEnd - windowStart) / 1000) : 0,
    },
    clients,
    divergence: computeDivergence(traces.clients, traces.server, windowStart, windowEnd),
  };
}

/** Headline metrics used for run-variance reporting and compare verdicts. */
export function headlineMetrics(card: Scorecard): Record<string, number> {
  const clientReports = Object.values(card.clients);
  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const shapeP95s = clientReports.flatMap((c) =>
    Object.values(c.perEntity).map((e) => e.shapeErrorPx.p95),
  );
  return {
    "divergence.remoteVsRemotePx.p95": card.divergence.remoteVsRemotePx.p95,
    "divergence.remoteVsRemotePx.p50": card.divergence.remoteVsRemotePx.p50,
    "divergence.ownVsRemotePx.p95": card.divergence.ownVsRemotePx.p95,
    "smoothness.teleportsPerMin": avg(clientReports.map((c) => c.smoothness.teleportsPerMin)),
    "smoothness.jerkRms": avg(clientReports.map((c) => c.smoothness.jerkRms)),
    "smoothness.hardSnapsPerMin": avg(clientReports.map((c) => c.smoothness.hardSnapsPerMin)),
    "packet.gapRate": avg(clientReports.map((c) => c.packet.gapRate)),
    "packet.inputAckRttMs.p95": avg(clientReports.map((c) => c.packet.inputAckRttMs.p95)),
    "fidelity.shapeErrorPx.p95": avg(shapeP95s),
    "fidelity.renderLatencyMs": avg(
      clientReports.flatMap((c) => Object.values(c.perEntity).map((e) => e.renderLatencyMs)),
    ),
    "server.tickDurMs.p95": card.server.tickDurMs.p95,
  };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Element-wise median across run scorecards (numbers only; first card's shape wins). */
function medianWalk(cards: unknown[]): unknown {
  const first = cards[0];
  if (typeof first === "number") {
    return medianOf(cards.filter((c): c is number => typeof c === "number"));
  }
  if (Array.isArray(first)) return first;
  if (first !== null && typeof first === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(first)) {
      out[key] = medianWalk(
        cards
          .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
          .map((c) => c[key]),
      );
    }
    return out;
  }
  return first;
}

export function aggregateScorecards(cards: Scorecard[]): Scorecard {
  const first = cards[0];
  if (!first) throw new Error("aggregateScorecards: no runs");
  if (cards.length === 1) return first;

  const aggregated = medianWalk(cards) as Scorecard;
  aggregated.runs = cards.length;
  aggregated.createdAt = first.createdAt;
  aggregated.scenario = first.scenario;
  aggregated.gitCommit = first.gitCommit;
  aggregated.branch = first.branch;

  const variance: Record<string, number> = {};
  const perRun = cards.map(headlineMetrics);
  const firstRun = perRun[0];
  if (firstRun) {
    for (const key of Object.keys(firstRun)) {
      const values = perRun.map((r) => r[key] ?? 0);
      variance[key] = Math.max(...values) - Math.min(...values);
    }
  }
  aggregated.runVariance = variance;
  return aggregated;
}
