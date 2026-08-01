/**
 * Scenario registry. Latencies are ONE-WAY per direction — a 50ms up + 50ms
 * down profile is a ~100ms RTT player. All scenarios disable NPCs so the
 * only motion is bot-driven and reproducible from the seed.
 */

import type { DirectionProfile, NetProfile, Scenario } from "./types.js";

const flat = (baseMs: number): DirectionProfile => ({ baseMs, jitter: { kind: "none" } });
const wobble = (baseMs: number, sigmaMs: number): DirectionProfile => ({
  baseMs,
  jitter: { kind: "normal", sigmaMs },
});
const symmetric = (up: DirectionProfile, down?: DirectionProfile): NetProfile => ({
  up,
  down: down ?? { ...up },
});

const BASE = {
  seed: 1337,
  durationMs: 60_000,
  warmupMs: 5_000,
  respawnDelayMs: 750,
  tunables: { npcCount: 0 },
};

export const SCENARIOS: Record<string, Scenario> = {
  "control-0ms": {
    ...BASE,
    name: "control-0ms",
    description: "No proxy at all — harness noise floor. Teleports and divergence should be ~0.",
    clients: [
      { name: "bot-a", behavior: { kind: "wander" } },
      { name: "bot-b", behavior: { kind: "wander" } },
      { name: "bot-c", behavior: { kind: "wander" } },
    ],
  },
  "baseline-3p-100ms": {
    ...BASE,
    name: "baseline-3p-100ms",
    description: "3 wandering players at ~100ms RTT with mild jitter — the default scorecard.",
    clients: [
      { name: "bot-a", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-b", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-c", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
    ],
  },
  "jitter-heavy-3p": {
    ...BASE,
    name: "jitter-heavy-3p",
    description: "Spiky delay (5% of chunks +30–120ms) — stresses the jitter buffer.",
    clients: [
      {
        name: "bot-a",
        behavior: { kind: "wander" },
        net: symmetric({
          baseMs: 50,
          jitter: { kind: "spike", probPerChunk: 0.05, minMs: 30, maxMs: 120 },
        }),
      },
      {
        name: "bot-b",
        behavior: { kind: "wander" },
        net: symmetric({
          baseMs: 50,
          jitter: { kind: "spike", probPerChunk: 0.05, minMs: 30, maxMs: 120 },
        }),
      },
      {
        name: "bot-c",
        behavior: { kind: "wander" },
        net: symmetric({
          baseMs: 50,
          jitter: { kind: "spike", probPerChunk: 0.05, minMs: 30, maxMs: 120 },
        }),
      },
    ],
  },
  "bursty-3p": {
    ...BASE,
    name: "bursty-3p",
    description:
      "Downstream stalls (250ms every 2s) — backpressure grows the server buffer and " +
      "forces real volatile snapshot drops, then a burst on release.",
    clients: [
      {
        name: "bot-a",
        behavior: { kind: "wander" },
        net: {
          up: flat(40),
          down: { baseMs: 40, jitter: { kind: "stall", periodMs: 2_000, durationMs: 250 } },
        },
      },
      {
        name: "bot-b",
        behavior: { kind: "wander" },
        net: {
          up: flat(40),
          down: { baseMs: 40, jitter: { kind: "stall", periodMs: 2_000, durationMs: 250 } },
        },
      },
      { name: "bot-c", behavior: { kind: "wander" }, net: symmetric(flat(40)) },
    ],
  },
  "asym-2p": {
    ...BASE,
    name: "asym-2p",
    description: "One ~75ms-RTT player vs one ~150ms-RTT player, steered to cross paths.",
    clients: [
      { name: "bot-a", behavior: { kind: "cross" }, net: symmetric(wobble(37, 4)) },
      { name: "bot-b", behavior: { kind: "cross" }, net: symmetric(wobble(75, 8)) },
    ],
  },
  "encounter-3p-100ms": {
    ...BASE,
    name: "encounter-3p-100ms",
    description:
      "Baseline latency but bots steer toward a shared rendezvous — frequent near-misses.",
    clients: [
      { name: "bot-a", behavior: { kind: "cross" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-b", behavior: { kind: "cross" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-c", behavior: { kind: "cross" }, net: symmetric(wobble(50, 5)) },
    ],
  },
  "spectator-plus-2p": {
    ...BASE,
    name: "spectator-plus-2p",
    description: "Two players plus a pure spectator — observer-view consistency.",
    clients: [
      { name: "bot-a", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-b", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "spectator", behavior: { kind: "spectator" }, net: symmetric(wobble(50, 5)) },
    ],
  },
};

export function getScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(`unknown scenario "${name}" — known: ${Object.keys(SCENARIOS).join(", ")}`);
  }
  return scenario;
}
