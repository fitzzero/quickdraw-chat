/**
 * Scorecard persistence + the human-readable summary table.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Scorecard } from "./types.js";

export function saveScorecard(card: Scorecard, resultsDir: string): string {
  const stamp = card.createdAt.replace(/[:.]/g, "-");
  const label = card.label ? `-${card.label}` : "";
  const file = join(
    resultsDir,
    card.scenario,
    `${stamp}-${card.gitCommit.slice(0, 7)}${label}.json`,
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`);
  return file;
}

export function loadScorecard(path: string): Scorecard {
  const card = JSON.parse(readFileSync(path, "utf8")) as Scorecard;
  if (card.schemaVersion !== 1) {
    throw new Error(`unsupported scorecard schemaVersion ${String(card.schemaVersion)}: ${path}`);
  }
  return card;
}

const num = (v: number, digits = 1): string => v.toFixed(digits);

export function printSummary(card: Scorecard): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(
    `━━ ${card.scenario}  (tier ${card.tier}, ${card.runs} run${card.runs > 1 ? "s" : ""}, ` +
      `${Math.round(card.durationMs / 1000)}s, ${card.gitCommit.slice(0, 7)}@${card.branch})`,
  );
  push("");
  push("  Divergence (px)            p50      p95      max");
  const d = card.divergence;
  push(
    `    remote vs remote      ${pad(num(d.remoteVsRemotePx.p50))} ${pad(num(d.remoteVsRemotePx.p95))} ${pad(num(d.remoteVsRemotePx.max))}`,
  );
  push(
    `    own vs remote         ${pad(num(d.ownVsRemotePx.p50))} ${pad(num(d.ownVsRemotePx.p95))} ${pad(num(d.ownVsRemotePx.max))}`,
  );
  push("");
  push(
    "  Client                 tele/min  jerkRMS  snaps/min  gap%   ackRTT p95  interArr p95  fps",
  );
  for (const [id, c] of Object.entries(card.clients)) {
    push(
      `    ${id.padEnd(20)} ${pad(num(c.smoothness.teleportsPerMin))} ${pad(num(c.smoothness.jerkRms, 0))} ` +
        `${pad(num(c.smoothness.hardSnapsPerMin))} ${pad(num(c.packet.gapRate * 100, 2))} ` +
        `${pad(num(c.packet.inputAckRttMs.p95, 0))} ${pad(num(c.packet.interArrivalMs.p95, 0))} ` +
        `${pad(num(c.effectiveFps, 0))}`,
    );
  }
  push("");
  push("  Fidelity per entity (client → entity: renderLatency ms / shapeErr p95 px)");
  for (const [id, c] of Object.entries(card.clients)) {
    for (const [entityId, e] of Object.entries(c.perEntity)) {
      const own = entityId === id || entityId.length > 12 ? "" : "";
      push(
        `    ${id} → ${entityId.slice(0, 12).padEnd(12)}${own}  ${pad(num(e.renderLatencyMs, 0))} / ${num(e.shapeErrorPx.p95)}`,
      );
    }
    if (c.predictionErrorPx) {
      push(`    ${id} local prediction error p95: ${num(c.predictionErrorPx.p95)} px`);
    }
  }
  push("");
  push(
    `  Server: tick p95 ${num(card.server.tickDurMs.p95, 2)}ms, ` +
      `snapshot p95 ${num(card.server.snapshotBytes.p95, 0)}B, ` +
      `rate ${num(card.server.effectiveTickRate, 2)}Hz`,
  );
  if (card.runVariance) {
    const worst = Object.entries(card.runVariance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    push(
      `  Run spread (max−min over ${card.runs} runs): ` +
        worst.map(([k, v]) => `${k}=${num(v, 2)}`).join(", "),
    );
  }
  return lines.join("\n");
}

function pad(s: string, width = 8): string {
  return s.padStart(width);
}
