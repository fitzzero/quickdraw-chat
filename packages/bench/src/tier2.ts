/**
 * The browser tier's acceptance: absolute, per display rate, a desk check.
 * A Tier-2 number is not a cross-machine baseline (a 144 Hz desktop and a
 * 60 Hz laptop render different frames), so a run is judged against the
 * limits of the rate it ran at, and `bench:compare` still works between
 * two runs on the same desk. docs/netcode-bench.md states the same table.
 *
 * The limits follow the display period: a rAF loop locked to vsync cannot
 * beat it, so frame time p95 may be the period plus 15 % of jitter, and p99
 * 1.75 periods, under one dropped frame's worth (two periods): fewer than
 * one frame in a hundred dropped. Long tasks and geometry builds are 0 a
 * minute at any rate.
 */

import type { Scorecard } from "./types.js";

export interface Tier2Acceptance {
  /** the display rate the limits are for */
  hz: number;
  frameTimeP95Ms: number;
  frameTimeP99Ms: number;
}

const P95_PERIODS = 1.15;
const P99_PERIODS = 1.75;
/** The display rates a desk is likely to run at; a measured rate snaps to the nearest. */
const COMMON_RATES = [60, 75, 90, 120, 144, 165, 240];

/** The acceptance at a display rate: the frame-time tails as multiples of its period. */
export function acceptanceFor(hz: number): Tier2Acceptance {
  const period = 1000 / hz;
  const tenth = (value: number): number => Math.round(value * 10) / 10;
  return {
    hz,
    frameTimeP95Ms: tenth(period * P95_PERIODS),
    frameTimeP99Ms: tenth(period * P99_PERIODS),
  };
}

/** The table for the common rates (the docs show it). */
export const TIER2_ACCEPTANCE: readonly Tier2Acceptance[] = COMMON_RATES.map(acceptanceFor);

/** The common display rate nearest a measured one (a 59.8 Hz loop ran at 60). */
export function displayRateOf(measuredHz: number): number {
  let nearest = COMMON_RATES[0] ?? 60;
  for (const rate of COMMON_RATES) {
    if (Math.abs(rate - measuredHz) < Math.abs(nearest - measuredHz)) nearest = rate;
  }
  return nearest;
}

export interface Tier2Verdict {
  /** the display rate the run looks to have had (from its frame time p50), null without frames */
  measuredHz: number | null;
  /** the acceptance judged against: the rate the runner declared, else the common rate nearest the measured one */
  acceptance: Tier2Acceptance;
  lines: string[];
  passed: boolean;
}

/** A number an older card may lack: NaN then, which no limit admits. */
const held = (value: number | undefined): number => value ?? Number.NaN;

/**
 * Judges a Tier-2 card against the acceptance of its display rate: the one
 * the runner declared (`tier2.displayHz`, from `--hz`), else the common
 * rate nearest the one its frames show, which cannot tell a display at
 * half rate from a slower display, so a desk declares its rate. The
 * frame-time tails against the rate's limits; long tasks, geometry builds
 * and pauses against zero. A card without a Tier-2 block, or without a
 * rendered frame, fails: there is nothing to pass.
 */
export function judgeTier2(card: Scorecard): Tier2Verdict {
  const tier2 = card.tier2;
  const frames = tier2?.frameTimeMs;
  const measuredHz =
    frames !== undefined && frames.n > 0 && frames.p50 > 0 ? Math.round(1000 / frames.p50) : null;
  const declared = tier2?.displayHz;
  const acceptance = acceptanceFor(declared ?? displayRateOf(measuredHz ?? 60));
  if (!tier2) {
    return {
      measuredHz,
      acceptance,
      lines: ["  Tier 2: no browser client in this card"],
      passed: false,
    };
  }
  if (tier2.frameTimeMs.n === 0) {
    return {
      measuredHz,
      acceptance,
      lines: [`  Tier 2 on ${tier2.backend}: no frame rendered`],
      passed: false,
    };
  }
  const checks: { label: string; value: number; limit: number; unit: string }[] = [
    {
      label: "frame time p95",
      value: tier2.frameTimeMs.p95,
      limit: acceptance.frameTimeP95Ms,
      unit: "ms",
    },
    {
      label: "frame time p99",
      value: held(tier2.frameTimeMs.p99),
      limit: acceptance.frameTimeP99Ms,
      unit: "ms",
    },
    { label: "long tasks", value: held(tier2.longTasksPerMin), limit: 0, unit: "/min" },
    { label: "geometry builds", value: held(tier2.geometryBuildsPerMin), limit: 0, unit: "/min" },
    { label: "pauses", value: held(tier2.pausesPerMin), limit: 0, unit: "/min" },
  ];
  const rate =
    declared === undefined
      ? `judged at ${acceptance.hz} Hz (from the frames; --hz declares the display)`
      : `judged at the declared ${acceptance.hz} Hz`;
  const lines = [
    `  Tier 2 at ~${measuredHz ?? "?"} Hz on ${tier2.backend}, ${rate}:`,
    ...checks.map(
      (c) =>
        `    ${c.value <= c.limit ? "✓" : "✗"} ${c.label} ${c.value.toFixed(c.unit === "ms" ? 1 : 2)} ${c.unit}` +
        ` (${c.limit === 0 ? "must be 0" : `at most ${c.limit} ${c.unit}`})`,
    ),
  ];
  return { measuredHz, acceptance, lines, passed: checks.every((c) => c.value <= c.limit) };
}
