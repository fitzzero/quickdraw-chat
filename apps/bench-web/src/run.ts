/**
 * Tier-2 netcode benchmark runner — real Chromium running the web app's
 * game client (apps/web/src/game: the shared netcode core under a PixiJS
 * renderer).
 *
 *   bun run --cwd apps/bench-web bench                               # the default list, both GPU backends
 *   bun run --cwd apps/bench-web bench -- --scenario render-stress-8p --gpu webgl
 *   bun run --cwd apps/bench-web bench -- --all --label desk
 *
 * Requires the web dev server (bun run dev). For each scenario and backend
 * it spawns the standalone bench server (which owns the latency proxies),
 * opens one browser context per scenario client at /game?bench=1&gpu=…,
 * drains window.QuickdrawBench telemetry every second, and emits the same
 * scorecard format as Tier 1 (tier: 2) with the browser tier's own block:
 * frame-time tails, long tasks, geometry builds, draw calls, the backend.
 * Each card is judged against the absolute acceptance of the display rate
 * it ran at (TIER2_ACCEPTANCE, docs/netcode-bench.md); the process exits 1
 * when a card fails it, so a desk check gates.
 *
 * Headed by default: headless SwiftShader WebGL tanks FPS and would poison
 * the smoothness metrics. Pass --headless knowingly. --window-position x,y
 * puts the browser on the display meant (the 144 Hz one).
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { ClientTrace, RunTraces, Scenario, Scorecard, ServerTrace } from "@project/bench";
import { sleep, startMouseWander } from "./wander.js";
import {
  SCENARIOS,
  computeScorecard,
  getScenario,
  judgeTier2,
  printSummary,
  saveScorecard,
} from "@project/bench";

const RESULTS_DIR = resolve(process.cwd(), "../../bench-results");
const API_DIR = resolve(process.cwd(), "../api");

/** The desk check's list: the baseline, the jittery link, and the renderer's load test. */
const DEFAULT_SCENARIOS = ["baseline-3p-100ms", "jitter-heavy-3p", "render-stress-8p"];

type Gpu = "webgl" | "webgpu";

interface BenchClient {
  name: string;
  userId: string;
  port: number;
}

/** What the page's BenchTelemetry flushes (apps/web/src/game/bench.ts). */
interface TelemetryBatch {
  frames?: { t: number; e: Record<string, [number, number]> }[];
  snapshots?: { t: number; tick: number }[];
  inputs?: { seq: number; t: number }[];
  corrections?: { t: number; m: number; h: boolean }[];
  fps?: { t: number; v: number }[];
  longTasks?: { t: number; d: number }[];
  renderer?: {
    t: number;
    backend: string | null;
    drawCalls: number | null;
    geometryBuilds: number;
  }[];
}

interface CliArgs {
  scenarios: string[];
  webUrl: string;
  headless: boolean;
  label?: string;
  gpus: Gpu[];
  windowPosition?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenarios: DEFAULT_SCENARIOS,
    webUrl: "http://localhost:3000",
    headless: false,
    gpus: ["webgl", "webgpu"],
  };
  const next = (i: number): string => {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${argv[i]} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario") args.scenarios = [next(i++)];
    else if (arg === "--all") {
      // every scenario the browser tier runs: a party's bots play over loopback links, Tier 1's alone
      args.scenarios = Object.values(SCENARIOS)
        .filter((s) => (s.tiers?.includes(2) ?? true) && s.party === undefined)
        .map((s) => s.name);
    } else if (arg === "--web-url") args.webUrl = next(i++);
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--label") args.label = next(i++);
    else if (arg === "--gpu") {
      const gpu = next(i++);
      if (gpu === "both") args.gpus = ["webgl", "webgpu"];
      else if (gpu === "webgl" || gpu === "webgpu") args.gpus = [gpu];
      else throw new Error(`--gpu takes webgl, webgpu or both, not ${JSON.stringify(gpu)}`);
    } else if (arg === "--window-position") args.windowPosition = next(i++);
    else if (arg === "--help") {
      console.log(
        "usage: bench [--scenario <name> | --all] [--gpu webgl|webgpu|both] [--web-url url] [--headless] [--label text] [--window-position x,y]",
      );
      console.log(`default scenarios: ${DEFAULT_SCENARIOS.join(", ")}`);
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

function log(message: string): void {
  console.log(`[bench-web] ${message}`);
}

async function assertWebServer(webUrl: string): Promise<void> {
  try {
    const response = await fetch(`${webUrl}/game`, { redirect: "manual" });
    if (response.status >= 500) throw new Error(`status ${response.status}`);
  } catch (error) {
    throw new Error(`web dev server not reachable at ${webUrl} — start it with \`bun run dev\``, {
      cause: error,
    });
  }
}

function startStandalone(
  scenario: Scenario,
  traceOut: string,
): Promise<{
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
    longTasks: [],
    renderer: { backend: null, samples: [] },
  };
}

/** The netcode half of a batch: frames, arrivals, sends and corrections, as Tier 1 records them. */
function ingestNetcode(trace: ClientTrace, batch: TelemetryBatch): void {
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
}

/** The page's half of a batch: fps samples, the main thread's long tasks and the renderer's stats. */
function ingestPage(trace: ClientTrace, batch: TelemetryBatch): void {
  for (const sample of batch.fps ?? []) {
    trace.fpsSamples?.push({ tWall: sample.t, fps: sample.v });
  }
  for (const task of batch.longTasks ?? []) {
    trace.longTasks?.push({ tWall: task.t, durationMs: task.d });
  }
  const renderer = trace.renderer;
  if (!renderer) return;
  for (const sample of batch.renderer ?? []) {
    if (sample.backend !== null) renderer.backend = sample.backend;
    renderer.samples.push({
      tWall: sample.t,
      drawCalls: sample.drawCalls,
      geometryBuilds: sample.geometryBuilds,
    });
  }
}

function ingestBatches(trace: ClientTrace, batches: TelemetryBatch[]): void {
  for (const batch of batches) {
    ingestNetcode(trace, batch);
    ingestPage(trace, batch);
  }
}

async function drainPage(page: Page): Promise<TelemetryBatch[]> {
  return (await page.evaluate(() => window.QuickdrawBench?.drain() ?? [])) as TelemetryBatch[];
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

/**
 * Chromium's flags for a run: the window on the display meant, and for
 * WebGPU what Chromium on Linux still keeps behind flags (Vulkan and the
 * API itself); the page's renderer falls back to WebGL where it is not
 * there, and the card's `tier2.backend` says which one ran.
 */
function chromiumArgs(gpu: Gpu, windowPosition: string | undefined): string[] {
  return [
    ...(windowPosition === undefined ? [] : [`--window-position=${windowPosition}`]),
    ...(gpu === "webgpu" ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan"] : []),
  ];
}

/** One scenario on one GPU backend: the bench server, the pages, the traces, the card. */
async function runOnce(scenario: Scenario, gpu: Gpu, args: CliArgs): Promise<Scorecard> {
  const traceOut = join(mkdtempSync(join(tmpdir(), "bench-web-")), "server-trace.json");
  log(`starting bench server (scenario ${scenario.name}, ${gpu})…`);
  const { child, clients } = await startStandalone(scenario, traceOut);

  let browser: Browser | undefined;
  const traces = new Map<string, ClientTrace>();
  const pages: { client: BenchClient; page: Page }[] = [];

  // The server stops in `finally`, whatever failed: a browser that would not
  // launch included
  try {
    browser = await chromium.launch({
      headless: args.headless,
      args: chromiumArgs(gpu, args.windowPosition),
    });
    for (const client of clients) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const url =
        `${args.webUrl}/game?bench=1&gpu=${gpu}` +
        `&benchApi=${encodeURIComponent(`http://127.0.0.1:${client.port}`)}` +
        `&benchUser=${encodeURIComponent(client.userId)}`;
      log(`opening ${client.name} → ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      traces.set(client.name, emptyTrace(client));
      pages.push({ client, page });
    }

    // The page's first compile and the world join can take a while on a cold load
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
    await browser?.close();
    child.stdin?.write("stop\n");
    await new Promise<void>((r) => {
      child.once("exit", () => r());
      setTimeout(r, 10_000);
    });
  }

  const server = JSON.parse(readFileSync(traceOut, "utf8")) as ServerTrace;
  const runTraces: RunTraces = { server, clients: Array.from(traces.values()) };
  return computeScorecard(runTraces, scenario, {
    tier: 2,
    ...gitMeta(),
    // the backend in every card's label, beside tier2.backend
    label: args.label === undefined ? gpu : `${args.label}-${gpu}`,
  });
}

const args = parseArgs(process.argv.slice(2));
const scenarios = args.scenarios.map((name) => getScenario(name));
for (const scenario of scenarios) {
  // Tier 2 plays the server's world through latency proxies: a party's bots
  // play over loopback links, which only Tier 1 (bench:netcode) runs
  if (scenario.party !== undefined) {
    console.error(`${scenario.name} is a party scenario: run it with bench:netcode (Tier 1)`);
    process.exit(2);
  }
  if (scenario.tiers !== undefined && !scenario.tiers.includes(2)) {
    console.error(
      `${scenario.name} is not a browser-tier scenario (tiers: ${scenario.tiers.join(", ")})`,
    );
    process.exit(2);
  }
}
await assertWebServer(args.webUrl);

let failed = false;
for (const scenario of scenarios) {
  for (const gpu of args.gpus) {
    const card = await runOnce(scenario, gpu, args);
    const file = saveScorecard(card, RESULTS_DIR);
    const verdict = judgeTier2(card);
    if (!verdict.passed) failed = true;
    console.log(`\n${printSummary(card)}`);
    console.log(verdict.lines.join("\n"));
    if (card.tier2 !== undefined && card.tier2.backend !== gpu) {
      console.log(
        `  (asked for ${gpu}, the page ran ${card.tier2.backend}: the browser has no ${gpu} here, so this card gates the backend it ran on)`,
      );
    }
    console.log(`\n  saved → ${file}`);
  }
}
console.log(
  failed
    ? "\n[bench-web] RESULT: FAIL (a card is over the acceptance of its display rate)"
    : "\n[bench-web] RESULT: PASS",
);
process.exit(failed ? 1 : 0);
