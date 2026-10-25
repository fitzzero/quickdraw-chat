/**
 * Scorecard computation: one run's traces → one Scorecard, plus median-of-N
 * aggregation across repeated runs of the same scenario.
 */

import type { ClientReport, PartyFairness, RunTraces, Scenario, Scorecard } from "../types.js";
import { computeDivergence, computeFidelity } from "./divergence.js";
import { computeFood } from "./food.js";
import { computeInputQueue, computeOwnQueue } from "./inputQueue.js";
import { computePacketHealth } from "./packets.js";
import { computeSmoothness } from "./smoothness.js";
import { computeTier2, tier2Metrics } from "./tier2.js";
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
    const ownQueue = computeOwnQueue(windowed, client);
    clients[client.clientId] = {
      kind: client.kind,
      packet: computePacketHealth(client, windowStart, windowEnd),
      smoothness: computeSmoothness(client, traces.server, windowStart, windowEnd),
      perEntity: fidelity.perEntity,
      ...(fidelity.predictionErrorPx ? { predictionErrorPx: fidelity.predictionErrorPx } : {}),
      effectiveFps:
        windowEnd > windowStart ? frames.length / ((windowEnd - windowStart) / 1000) : 0,
      ...(ownQueue ? { inputQueue: ownQueue } : {}),
      ...computeFood(client, traces.server),
    };
  }
  const inputQueue = computeInputQueue(windowed);

  // Tier 2: the real render loop's frame times and fps, the pages' long
  // tasks and the renderers' stats; a browser trace carries fpsSamples
  const tier2Clients = traces.clients.filter((c) => c.fpsSamples !== undefined);

  return {
    schemaVersion: 2,
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
      ...(inputQueue ? { inputQueue } : {}),
    },
    clients,
    divergence: computeDivergence(traces.clients, traces.server, windowStart, windowEnd),
    ...(tier2Clients.length > 0
      ? { tier2: computeTier2(tier2Clients, windowStart, windowEnd) }
      : {}),
    ...partyOf(scenario, clients),
  };
}

/** A party scenario's fairness, as the scorecard holds it; nothing for the server's world. */
function partyOf(
  scenario: Scenario,
  clients: Record<string, ClientReport>,
): { party?: PartyFairness } {
  return scenario.party ? { party: partyFairness(scenario.party.host, clients) } : {};
}

/** A client's ack p50, or NaN when it has none (no input acknowledged). */
function ackP50(report: ClientReport | undefined): number {
  const stats = report?.packet.inputAckRttMs;
  return stats === undefined || stats.n === 0 ? Number.NaN : stats.p50;
}

/** A client's prediction error p95, or NaN when it has none (a spectator, too few samples). */
function predictionP95(report: ClientReport | undefined): number {
  const stats = report?.predictionErrorPx;
  return stats === undefined || stats.n === 0 ? Number.NaN : stats.p95;
}

/** The median of the finite values (the mean of the middle two for an even count); NaN for none. */
export function middleOf(values: readonly number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const half = Math.floor(sorted.length / 2);
  const upper = sorted[half] ?? Number.NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[half - 1] ?? upper) + upper) / 2;
}

/**
 * A party's fairness: the host's own user's input round trip p50 and
 * prediction error p95 against the other players' (the median of theirs).
 * With the fair link the host plays as they do; without it, its input
 * reaches the sim at once. A value no client measured is NaN.
 */
export function partyFairness(host: string, clients: Record<string, ClientReport>): PartyFairness {
  const own = clients[host];
  const peers = Object.entries(clients)
    .filter(([id]) => id !== host)
    .map(([, report]) => report);
  return {
    host,
    inputAckRttP50: { host: ackP50(own), peers: middleOf(peers.map(ackP50)) },
    predictionErrorP95: {
      host: predictionP95(own),
      peers: middleOf(peers.map(predictionP95)),
    },
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
    // Compared once both cards carry it (scorecards made before the input queue do not)
    ...(card.server.inputQueue
      ? { "server.inputQueue.depthP95": card.server.inputQueue.depthP95 }
      : {}),
    // Must be zero, once a card carries them (traces from before the step/ack check do not)
    ...(card.server.inputQueue?.stepAckMismatchPerMin === undefined
      ? {}
      : {
          "server.inputQueue.stepAckMismatchPerMin": card.server.inputQueue.stepAckMismatchPerMin,
        }),
    ...stepCorrectionsMetric(clientReports),
    ...foodMetric(clientReports),
    // The browser tier's tails and counts, on a card with a Tier-2 block
    ...tier2Metrics(card),
  };
}

/**
 * The most whole-step corrections a minute any client's local snake took:
 * each is a surge or a stall the player saw. Compared once both cards carry
 * it (scorecards made before it do not).
 */
function stepCorrectionsMetric(clients: ClientReport[]): Record<string, number> {
  const rates = clients.flatMap((c) =>
    c.smoothness.stepCorrectionsPerMin === undefined ? [] : [c.smoothness.stepCorrectionsPerMin],
  );
  return rates.length > 0 ? { "smoothness.stepCorrectionsPerMin": Math.max(...rates) } : {};
}

/**
 * The most food ids any client ended up differing from the server on: 0, or
 * a food change lost. Compared once both cards carry it (scorecards made
 * before the food window do not).
 */
function foodMetric(clients: ClientReport[]): Record<string, number> {
  const mismatches = clients.flatMap((c) =>
    c.foodMismatchAtEnd === undefined ? [] : [c.foodMismatchAtEnd],
  );
  return mismatches.length > 0 ? { "food.mismatchAtEnd": Math.max(...mismatches) } : {};
}

function medianOf(values: number[]): number {
  // a value no run measured (a party's NaN) is left out; none measured stays NaN
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return values.length > 0 ? Number.NaN : 0;
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
  aggregated.runWorst = worstRuns(perRun);
  return aggregated;
}

/**
 * Each headline metric's worst (highest) run, over the metrics any run
 * reports: a run without one makes it NaN (null once saved). The medians
 * cannot say it: a client's median hides the one run it went wrong in.
 */
function worstRuns(perRun: Record<string, number>[]): Record<string, number> {
  const worst: Record<string, number> = {};
  for (const key of new Set(perRun.flatMap((r) => Object.keys(r)))) {
    worst[key] = Math.max(...perRun.map((r) => r[key] ?? Number.NaN));
  }
  return worst;
}
