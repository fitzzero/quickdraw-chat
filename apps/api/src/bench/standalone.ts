/**
 * Standalone bench server for Tier-2 (browser) benchmark runs.
 *
 * Started by apps/bench-web. Boots the same bench server as Tier 1 (loop
 * running, ground-truth recorder) plus one latency proxy per scenario
 * client, then prints a single READY line:
 *
 *   READY {"serverPort":N,"clients":[{"name","userId","port"}...]}
 *
 * The runner sends "stop\n" on stdin when the run is over; the server
 * writes the ground-truth ServerTrace JSON to --trace-out and exits.
 */

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
process.env.SERVICE_DEFAULT_ACCESS = "userService:Read";

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const { getScenario, startLatencyProxy } = await import("@project/bench");
const { startBenchServer, shutdownBenchDatabase } = await import("./server.js");

type LatencyProxy = import("@project/bench").LatencyProxy;

const argv = process.argv.slice(2);
let scenarioName = "baseline-3p-100ms";
let traceOut = "";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--scenario") scenarioName = argv[++i] ?? scenarioName;
  else if (argv[i] === "--trace-out") traceOut = argv[++i] ?? "";
}
if (!traceOut) {
  console.error("standalone bench server: --trace-out <file> is required");
  process.exit(2);
}

const scenario = getScenario(scenarioName);
const server = await startBenchServer(scenario);
const proxies: LatencyProxy[] = [];
const clients: { name: string; userId: string; port: number }[] = [];

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
  if (!userId) throw new Error(`no user for client ${spec.name}`);
  clients.push({ name: spec.name, userId, port });
}

console.log(`READY ${JSON.stringify({ serverPort: server.port, clients })}`);

async function shutdown(): Promise<void> {
  writeFileSync(traceOut, JSON.stringify(server.recorder.trace()));
  for (const proxy of proxies) await proxy.stop();
  await server.stop();
  await shutdownBenchDatabase();
  process.exit(0);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "stop") void shutdown();
});
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
