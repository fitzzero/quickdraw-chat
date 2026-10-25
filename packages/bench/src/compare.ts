/**
 * Scorecard comparison — the keep/discard gate for netcode R&D.
 *
 * All headline metrics are lower-is-better. A delta counts as a regression
 * only when it exceeds BOTH the relative threshold and an absolute floor
 * (so a 0.2px change on a 1px base never fails a build), and it is reported
 * as within-noise when the delta is smaller than the measured run-to-run
 * spread of either card.
 */

import type { Scorecard } from "./types.js";
import { headlineMetrics } from "./metrics/index.js";

export interface CompareThresholds {
  /** relative worsening (fraction, e.g. 0.15) that fails */
  failPct: number;
  /** relative worsening that warns */
  warnPct: number;
  /** absolute per-metric floors below which deltas are ignored */
  absoluteFloor: Record<string, number>;
}

export const DEFAULT_THRESHOLDS: CompareThresholds = {
  failPct: 0.15,
  warnPct: 0.05,
  absoluteFloor: {
    "divergence.remoteVsRemotePx.p95": 0.5,
    "divergence.remoteVsRemotePx.p50": 0.5,
    "divergence.ownVsRemotePx.p95": 2,
    "smoothness.teleportsPerMin": 0.2,
    "smoothness.jerkRms": 25,
    "smoothness.hardSnapsPerMin": 0.2,
    "packet.gapRate": 0.005,
    "packet.inputAckRttMs.p95": 3,
    "fidelity.shapeErrorPx.p95": 0.5,
    "fidelity.renderLatencyMs": 5,
    "server.tickDurMs.p95": 0.05,
    // A client's queue holds 0 or 1 frames by the phase it connected at; a
    // ratchet toward the cap grows by more
    "server.inputQueue.depthP95": 1,
    // One whole-step correction a minute on one client is a late frame's
    // change of intent at a sharp turn, not the queue; a run of them is
    "smoothness.stepCorrectionsPerMin": 1,
  },
};

export type Verdict = "ok" | "improved" | "within-noise" | "warn" | "fail";

/**
 * Headline metrics that must be 0 in every run (judged on the worst one):
 * any other value fails, whatever the baseline and the run spread. A food
 * mismatch is a change a client lost; a step/ack mismatch is a movement step
 * the client's replay did not predict (a 9 px jolt on its snake).
 */
export const MUST_BE_ZERO: readonly string[] = [
  "food.mismatchAtEnd",
  "server.inputQueue.stepAckMismatchPerMin",
];

export interface MetricComparison {
  metric: string;
  baseline: number;
  candidate: number;
  deltaAbs: number;
  deltaPct: number | null;
  verdict: Verdict;
}

export interface CompareResult {
  scenario: string;
  comparisons: MetricComparison[];
  failed: boolean;
}

/** The verdict on one metric's delta (`deltaPct` null: a zero baseline). */
export function judge(
  deltaAbs: number,
  deltaPct: number | null,
  floor: number,
  noise: number,
  thresholds: CompareThresholds,
): Verdict {
  if (Math.abs(deltaAbs) <= floor) return "ok";
  if (Math.abs(deltaAbs) <= noise) return "within-noise";
  if (deltaAbs < 0) return "improved";
  // From zero, any growth past the floor is a regression (a first teleport, a queue that grows)
  if (deltaPct === null) return "fail";
  if (deltaPct > thresholds.failPct) return "fail";
  if (deltaPct > thresholds.warnPct) return "warn";
  return "ok";
}

/**
 * The verdict on a must-be-zero metric, from the candidate's worst run (an
 * aggregated card's `runWorst`, or a single run's value). A missing value
 * (or NaN, a run without the metric) fails too: the harness lost it.
 */
export function judgeZero(worst: number | null | undefined): Verdict {
  return worst === 0 ? "ok" : "fail";
}

/**
 * The must-be-zero metrics, judged on the candidate alone, once either card
 * carries them (a baseline made before one does not).
 */
function zeroComparisons(
  base: Record<string, number>,
  cand: Record<string, number>,
  candidate: Scorecard,
): MetricComparison[] {
  return MUST_BE_ZERO.filter((metric) => metric in base || metric in cand).map((metric) => {
    const worst = candidate.runWorst ? candidate.runWorst[metric] : cand[metric];
    const baseValue = base[metric] ?? 0;
    const candValue = worst ?? Number.NaN;
    return {
      metric,
      baseline: baseValue,
      candidate: candValue,
      deltaAbs: candValue - baseValue,
      deltaPct: null,
      verdict: judgeZero(worst),
    };
  });
}

export function compareScorecards(
  baseline: Scorecard,
  candidate: Scorecard,
  thresholds: CompareThresholds = DEFAULT_THRESHOLDS,
): CompareResult {
  if (baseline.scenario !== candidate.scenario) {
    throw new Error(
      `scenario mismatch: baseline is "${baseline.scenario}", candidate is "${candidate.scenario}"`,
    );
  }

  const base = headlineMetrics(baseline);
  const cand = headlineMetrics(candidate);
  const comparisons: MetricComparison[] = [];

  for (const [metric, baseValue] of Object.entries(base)) {
    if (MUST_BE_ZERO.includes(metric)) continue;
    const candValue = cand[metric] ?? 0;
    const deltaAbs = candValue - baseValue;
    const deltaPct = baseValue === 0 ? null : deltaAbs / baseValue;
    const noise = Math.max(
      baseline.runVariance?.[metric] ?? 0,
      candidate.runVariance?.[metric] ?? 0,
    );
    const verdict = judge(
      deltaAbs,
      deltaPct,
      thresholds.absoluteFloor[metric] ?? 0,
      noise,
      thresholds,
    );
    comparisons.push({
      metric,
      baseline: baseValue,
      candidate: candValue,
      deltaAbs,
      deltaPct,
      verdict,
    });
  }

  comparisons.push(...zeroComparisons(base, cand, candidate));

  return {
    scenario: baseline.scenario,
    comparisons,
    failed: comparisons.some((c) => c.verdict === "fail"),
  };
}

const BADGES: Record<Verdict, string> = {
  ok: "  ·",
  improved: "  ✓",
  "within-noise": "  ~",
  warn: "  ⚠",
  fail: "  ✗",
};

export function printComparison(result: CompareResult): string {
  const lines: string[] = [];
  lines.push(`━━ compare: ${result.scenario}`);
  lines.push(
    `   ${"metric".padEnd(36)} ${"baseline".padStart(10)} ${"candidate".padStart(10)} ${"Δ%".padStart(8)}`,
  );
  for (const c of result.comparisons) {
    const pct = c.deltaPct === null ? "  n/a" : `${(c.deltaPct * 100).toFixed(1)}%`;
    lines.push(
      `${BADGES[c.verdict]} ${c.metric.padEnd(36)} ${c.baseline.toFixed(2).padStart(10)} ` +
        `${c.candidate.toFixed(2).padStart(10)} ${pct.padStart(8)}  ${c.verdict === "ok" ? "" : c.verdict}`,
    );
  }
  lines.push(result.failed ? "   RESULT: FAIL" : "   RESULT: PASS");
  return lines.join("\n");
}
