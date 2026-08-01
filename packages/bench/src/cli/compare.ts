/**
 * bench:compare <baseline.json> <candidate.json> [--thresholds file.json]
 *
 * Exit code 0 = pass, 1 = at least one headline metric regressed beyond
 * thresholds. Used by the netcode R&D loop as the keep/discard gate.
 */

import { readFileSync } from "node:fs";
import { loadScorecard } from "../scorecard.js";
import { compareScorecards, DEFAULT_THRESHOLDS, printComparison } from "../compare.js";
import type { CompareThresholds } from "../compare.js";

const argv = process.argv.slice(2);
const positional: string[] = [];
let thresholds: CompareThresholds = DEFAULT_THRESHOLDS;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--thresholds") {
    const path = argv[++i];
    if (!path) throw new Error("--thresholds requires a file path");
    thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(readFileSync(path, "utf8")) };
  } else if (arg === "--help") {
    console.log("usage: bench:compare <baseline.json> <candidate.json> [--thresholds file.json]");
    process.exit(0);
  } else if (arg) {
    positional.push(arg);
  }
}

const [baselinePath, candidatePath] = positional;
if (!baselinePath || !candidatePath) {
  console.error("usage: bench:compare <baseline.json> <candidate.json> [--thresholds file.json]");
  process.exit(2);
}

const result = compareScorecards(
  loadScorecard(baselinePath),
  loadScorecard(candidatePath),
  thresholds,
);
console.log(printComparison(result));
process.exit(result.failed ? 1 : 0);
