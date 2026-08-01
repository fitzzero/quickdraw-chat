/**
 * Tier-2 netcode benchmark runner — real Chromium + Godot WASM clients.
 *
 *   bun run --cwd apps/bench-web bench -- --scenario baseline-3p-100ms
 *
 * Requires the web dev server (bun run dev) and a WASM export that includes
 * the Bench autoload (apps/game/export-web.sh). Spawns the standalone bench
 * server (which owns the latency proxies), opens one browser context per
 * scenario client at /game?bench=1, drains window.QuickdrawBench telemetry
 * every second, and emits the same scorecard format as Tier 1 (tier: 2).
 *
 * Headed by default: headless SwiftShader WebGL tanks FPS and would poison
 * the smoothness metrics. Pass --headless knowingly.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import type { ClientTrace, RunTraces, Scenario, ServerTrace } from "@project/bench";
import { computeScorecard, getScenario, printSummary, saveScorecard } from "@project/bench";

const RESULTS_DIR = resolve(process.cwd(), "../../bench-results");
const API_DIR = resolve(process.cwd(), "../api");

interface BenchClient {
  name: string;
  userId: string;
  port: number;
}

interface TelemetryBatch {
  frames?: { t: number; e: Record<string, [number, number]> }[];
  snapshots?: { t: number; tick: number }[];
  inputs?: { seq: number; t: number }[];
  corrections?: { t: number; m: number; h: boolean }[];
  fps?: { t: number; v: number }[];
}

const argv = process.argv.slice(2);
let scenarioName = "baseline-3p-100ms";
let webUrl = "http://localhost:3000";
let headless = false;
let label: string | undefined;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--scenario") scenarioName = argv[++i] ?? scenarioName;
  else if (argv[i] === "--web-url") webUrl = argv[++i] ?? webUrl;
  else if (argv[i] === "--headless") headless = true;
  else if (argv[i] === "--label") label = argv[++i];
}

const scenario: Scenario = getScenario(scenarioName);

function log(message: string): void {
  console.log(`[bench-web] ${message}`);
}

async function assertWebServer(): Promise<void> {
  try {
    const response = await fetch(`${webUrl}/game`, { redirect: "manual" });
    if (response.status >= 500) throw new Error(`status ${response.status}`);
  } catch (error) {
    throw new Error(`web dev server not reachable at ${webUrl} — start it with \`bun run dev\``, {
      cause: error,
    });
  }
}

function startStandalone(traceOut: string): Promise<{
  child: ChildProcess;
  clients: BenchClient[];
}> {
  return new Promise((resolveReady, reject) => {
    const child = spawn(
      "bunx",
      ["tsx", "src/bench/standalone.ts", "--scenario", scenario.name, "--trace-out", traceOut],
      { cwd: API_DIR, stdio: ["pipe", "pipe", "inherit"] },
    );
    if (!child.stdout) {
      reject(new Error("bench server: no stdout pipe"));
      return;
    }
    const timeout = setTimeout(() => reject(new Error("bench server: READY timeout")), 120_000);
    createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.startsWith("READY ")) {
        clearTimeout(timeout);
        const info = JSON.parse(line.slice("READY ".length)) as { clients: BenchClient[] };
        resolveReady({ child, clients: info.clients });
      }
    });
    child.once("exit", (code) => reject(new Error(`bench server exited early (${code})`)));
  });
}

function emptyTrace(client: BenchClient): ClientTrace {
  return {
    clientId: client.name,
    kind: "browser",
    playerId: client.userId,
    frames: [],
    snapshots: [],
    corrections: [],
    inputs: [],
    fpsSamples: [],
  };
}

function ingestBatches(trace: ClientTrace, batches: TelemetryBatch[]): void {
  for (const batch of batches) {
    for (const frame of batch.frames ?? []) {
      const entities: Record<string, { x: number; y: number }> = {};
      for (const [id, pos] of Object.entries(frame.e)) {
        entities[id] = { x: pos[0], y: pos[1] };
      }
      trace.frames.push({ tWall: frame.t, entities });
    }
    for (const snap of batch.snapshots ?? []) {
      trace.snapshots.push({ tWall: snap.t, tick: snap.tick });
    }
    for (const input of batch.inputs ?? []) {
      trace.inputs.push({ seq: input.seq, tSent: input.t });
    }
    for (const correction of batch.corrections ?? []) {
      trace.corrections.push({
        tWall: correction.t,
        magnitudePx: correction.m,
        hard: correction.h,
      });
    }
    for (const sample of batch.fps ?? []) {
      trace.fpsSamples?.push({ tWall: sample.t, fps: sample.v });
    }
  }
}

async function drainPage(page: Page): Promise<TelemetryBatch[]> {
  return (await page.evaluate(() => window.QuickdrawBench?.drain() ?? [])) as TelemetryBatch[];
}

/**
 * The local snake aims at the mouse — in a bench browser nobody moves it, so
 * we drive a seeded wander through the REAL input path (Playwright mouse →
 * canvas → Godot). Mirrors the Tier-1 wander behavior in spirit: heading
 * random-walk around the viewport center, occasional boost via left button.
 */
function startMouseWander(page: Page, seed: number, signal: { stopped: boolean }): void {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cx = 640;
  const cy = 360;
  let heading = rng() * Math.PI * 2;
  let angularVel = 0;
  let nextRollAt = 0;
  let boosting = false;

  const loop = async (): Promise<void> => {
    const start = Date.now();
    while (!signal.stopped) {
      const tSec = (Date.now() - start) / 1000;
      if (tSec >= nextRollAt) {
        angularVel = (rng() - 0.5) * 2 * 1.5;
        nextRollAt = tSec + 1 + rng() * 2;
        const wantBoost = rng() < 0.15;
        if (wantBoost !== boosting) {
          boosting = wantBoost;
          try {
            await (wantBoost ? page.mouse.down() : page.mouse.up());
          } catch {
            break;
          }
        }
      }
      heading += angularVel * 0.1;
      const x = cx + Math.cos(heading) * 220;
      const y = cy + Math.sin(heading) * 220;
      try {
        await page.mouse.move(x, y);
      } catch {
        break;
      }
      await sleep(100);
    }
  };
  void loop();
}

function gitMeta(): { gitCommit: string; branch: string } {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return { gitCommit: run("git rev-parse HEAD"), branch: run("git rev-parse --abbrev-ref HEAD") };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

await assertWebServer();
const traceOut = join(mkdtempSync(join(tmpdir(), "bench-web-")), "server-trace.json");
log(`starting bench server (scenario ${scenario.name})…`);
const { child, clients } = await startStandalone(traceOut);

const browser = await chromium.launch({ headless });
const traces = new Map<string, ClientTrace>();
const pages: { client: BenchClient; page: Page }[] = [];

try {
  for (const client of clients) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const url =
      `${webUrl}/game?bench=1&benchApi=${encodeURIComponent(`http://127.0.0.1:${client.port}`)}` +
      `&benchUser=${encodeURIComponent(client.userId)}`;
    log(`opening ${client.name} → ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    traces.set(client.name, emptyTrace(client));
    pages.push({ client, page });
  }

  // WASM load + world join can take a while on first (cold) load
  log("waiting for telemetry from all clients…");
  await Promise.all(
    pages.map(({ page }) =>
      page.waitForFunction(() => (window.QuickdrawBench?.batches.length ?? 0) > 0, undefined, {
        timeout: 120_000,
        polling: 500,
      }),
    ),
  );

  log(`all clients live — running for ${scenario.durationMs / 1000}s…`);
  const wanderSignal = { stopped: false };
  pages.forEach(({ page }, index) => {
    startMouseWander(page, scenario.seed ^ (index * 2654435761), wanderSignal);
  });
  const endAt = Date.now() + scenario.durationMs;
  while (Date.now() < endAt) {
    await sleep(1000);
    for (const { client, page } of pages) {
      const trace = traces.get(client.name);
      if (trace) ingestBatches(trace, await drainPage(page));
    }
  }
  wanderSignal.stopped = true;
  await sleep(150);
  for (const { client, page } of pages) {
    const trace = traces.get(client.name);
    if (trace) ingestBatches(trace, await drainPage(page));
  }
} finally {
  await browser.close();
  child.stdin?.write("stop\n");
  await new Promise<void>((r) => {
    child.once("exit", () => r());
    setTimeout(r, 10_000);
  });
}

const server = JSON.parse(readFileSync(traceOut, "utf8")) as ServerTrace;
const runTraces: RunTraces = { server, clients: Array.from(traces.values()) };
const card = computeScorecard(runTraces, scenario, {
  tier: 2,
  ...gitMeta(),
  ...(label ? { label } : {}),
});
const file = saveScorecard(card, RESULTS_DIR);
console.log(`\n${printSummary(card)}`);
console.log(`\n  saved → ${file}`);
process.exit(0);
