/**
 * Tier-1 netcode benchmark runner.
 *
 *   bun run bench:netcode -- --scenario baseline-3p-100ms --runs 3
 *   bun run bench:netcode -- --all
 *
 * Per run: fresh bench server (loop running) → one latency proxy per bot
 * (per its scenario net profile) → bots connect and play for the scenario
 * duration → traces → scorecard. Runs aggregate as element-wise medians
 * with a run-variance report. Results land in bench-results/ at repo root.
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Bench env must be in place before any service module loads (they read env
// at import time). Mirrors __tests__/setup.ts.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
process.env.SERVICE_DEFAULT_ACCESS = "userService:Read";

// Services log through console-backed loggers with no level filtering; a
// benchmark process wants a quiet, I/O-free hot path. Keep stdout for the
// runner's own output (console.log is reserved for it below).
if (process.env.LOG_LEVEL !== "debug") {
  console.debug = () => {
    /* silenced for benchmarking */
  };
  console.info = () => {
    /* silenced for benchmarking */
  };
  // Core's consoleLogger routes info through console.log with an "[INFO]"
  // prefix — filter those, keep the runner's own output.
  const originalLog = console.log.bind(console);
  console.log = (...logArgs: unknown[]) => {
    const head = logArgs[0];
    if (typeof head === "string" && (head.startsWith("[INFO]") || head.startsWith("[DEBUG]"))) {
      return;
    }
    originalLog(...logArgs);
  };
}

const {
  getScenario,
  SCENARIOS,
  startLatencyProxy,
  computeScorecard,
  aggregateScorecards,
  saveScorecard,
  printSummary,
} = await import("@project/bench");
const { startBenchServer, shutdownBenchDatabase } = await import("./server.js");
const { BotClient } = await import("./bot/client.js");
const { DEFAULT_TUNABLES } = await import("../services/game/world.js");
const { GAME_TICK_RATE } = await import("@project/shared");

type Scenario = import("@project/bench").Scenario;
type Scorecard = import("@project/bench").Scorecard;
type RunTraces = import("@project/bench").RunTraces;
type LatencyProxy = import("@project/bench").LatencyProxy;

const RESULTS_DIR = resolve(process.cwd(), "../../bench-results");

interface CliArgs {
  scenarios: string[];
  runs: number;
  durationMs?: number;
  label?: string;
  saveTraces: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { scenarios: ["baseline-3p-100ms"], runs: 1, saveTraces: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--scenario") args.scenarios = [next()];
    else if (arg === "--all") args.scenarios = Object.keys(SCENARIOS);
    else if (arg === "--runs") args.runs = Math.max(1, Number(next()) || 1);
    else if (arg === "--duration") args.durationMs = Number(next()) * 1000;
    else if (arg === "--label") args.label = next();
    else if (arg === "--save-traces") args.saveTraces = true;
    else if (arg === "--help") {
      console.log(
        "usage: bench:netcode [--scenario <name> | --all] [--runs N] [--duration seconds] [--label text] [--save-traces]",
      );
      console.log(`scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exit(0);
    }
  }
  return args;
}

function gitMeta(): { gitCommit: string; branch: string } {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return {
    gitCommit: run("git rev-parse HEAD"),
    branch: run("git rev-parse --abbrev-ref HEAD"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

async function executeRun(scenario: Scenario): Promise<RunTraces> {
  const server = await startBenchServer(scenario);
  const proxies: LatencyProxy[] = [];
  const bots: InstanceType<typeof BotClient>[] = [];

  try {
    for (const spec of scenario.clients) {
      let port = server.port;
      if (spec.net) {
        const proxy = await startLatencyProxy({
          targetHost: "127.0.0.1",
          targetPort: server.port,
          up: spec.net.up,
          down: spec.net.down,
          seed: scenario.seed,
        });
        proxies.push(proxy);
        port = proxy.port;
      }
      const userId = server.users.get(spec.name);
      if (!userId) throw new Error(`no user for bot ${spec.name}`);
      bots.push(
        new BotClient({
          port,
          userId,
          name: spec.name,
          behaviorKind: spec.behavior.kind,
          scenario,
          tunables: { ...DEFAULT_TUNABLES, ...scenario.tunables },
          tickRate: GAME_TICK_RATE,
        }),
      );
    }

    // Stagger joins slightly — three simultaneous join transactions on a
    // fresh PGlite occasionally contend; real players never join in the
    // same millisecond either.
    for (const bot of bots) {
      await bot.start();
      await sleep(150);
    }

    await sleep(scenario.durationMs);

    const clients = bots.map((b) => b.stop());
    return { server: server.recorder.trace(), clients };
  } finally {
    for (const bot of bots) bot.stop();
    await Promise.all(proxies.map((p) => p.stop()));
    await server.stop();
  }
}

async function benchScenario(name: string, args: CliArgs): Promise<Scorecard> {
  const base = getScenario(name);
  const scenario: Scenario = args.durationMs ? { ...base, durationMs: args.durationMs } : base;
  const meta = { tier: 1 as const, ...gitMeta(), ...(args.label ? { label: args.label } : {}) };

  const cards: Scorecard[] = [];
  for (let run = 0; run < args.runs; run++) {
    console.log(`\n▶ ${name} — run ${run + 1}/${args.runs} (${scenario.durationMs / 1000}s)…`);
    const traces = await executeRun(scenario);
    if (args.saveTraces) {
      const dir = join(RESULTS_DIR, name, "traces");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `run-${run + 1}.json`), JSON.stringify(traces));
    }
    cards.push(computeScorecard(traces, scenario, meta));
  }

  const card = aggregateScorecards(cards);
  const file = saveScorecard(card, RESULTS_DIR);
  console.log(`\n${printSummary(card)}`);
  console.log(`\n  saved → ${file}`);
  return card;
}

const args = parseArgs(process.argv.slice(2));
try {
  for (const name of args.scenarios) {
    await benchScenario(name, args);
  }
} finally {
  await shutdownBenchDatabase();
}
process.exit(0);
