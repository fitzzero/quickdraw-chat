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

/** A party's links: 50 ms each way plus up to 15 ms, 5% of `fast` messages lost (input, snapshots). */
const PARTY_LINK = { ms: 50, jitter: 15, loss: 0.05 };

/** The host's own user and three players. */
const PARTY_CLIENTS: Scenario["clients"] = [
  { name: "host", behavior: { kind: "wander" } },
  { name: "bot-a", behavior: { kind: "wander" } },
  { name: "bot-b", behavior: { kind: "wander" } },
  { name: "bot-c", behavior: { kind: "wander" } },
];

/**
 * Party scenarios (host mode): no server. A host in process runs the
 * party's sim and loop (PartyWorld), and every bot plays over a loopback
 * link to it, carrying the app's payloads. `packet.gapRate` measures the
 * link's real loss.
 */
const PARTY_SCENARIOS: Record<string, Scenario> = {
  "party-3p-lossy": {
    ...BASE,
    name: "party-3p-lossy",
    description:
      "A party: three players on links to the host of 50 ms each way plus up to 15 ms, 5% of " +
      "fast messages lost, and the host's own user on a local link the host lags as its page " +
      "does (the fair link). Input redundancy and the queue keep prediction tight; the host " +
      "plays as its players.",
    clients: PARTY_CLIENTS,
    party: { host: "host", link: PARTY_LINK, fairLink: true },
  },
  "party-3p-unfair": {
    ...BASE,
    name: "party-3p-unfair",
    description:
      "party-3p-lossy without the fair link: the host's own user plays over its local link, " +
      "the advantage the fair link removes (reported, not gated).",
    clients: PARTY_CLIENTS,
    party: { host: "host", link: PARTY_LINK, fairLink: false },
  },
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
  "mixed-3p": {
    ...BASE,
    name: "mixed-3p",
    description:
      "Unequal links: one clean ~40ms-RTT player, one ~100ms with wide jitter (σ 15ms), one " +
      "~100ms with spikes — what each client's own interpolation delay costs the others.",
    clients: [
      { name: "bot-a", behavior: { kind: "wander" }, net: symmetric(flat(20)) },
      { name: "bot-b", behavior: { kind: "wander" }, net: symmetric(wobble(50, 15)) },
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
  "fps-varying-3p": {
    ...BASE,
    name: "fps-varying-3p",
    description:
      "Baseline latency but client frame rates oscillate 30-90fps out of phase " +
      "(browsers under varying load) — exposes frame-rate-dependent netcode.",
    clients: [
      {
        name: "bot-a",
        behavior: { kind: "wander" },
        net: symmetric(wobble(50, 5)),
        render: { minFps: 30, maxFps: 90, periodS: 7 },
      },
      {
        name: "bot-b",
        behavior: { kind: "wander" },
        net: symmetric(wobble(50, 5)),
        render: { minFps: 30, maxFps: 90, periodS: 7, phaseS: 2.3 },
      },
      {
        name: "bot-c",
        behavior: { kind: "wander" },
        net: symmetric(wobble(50, 5)),
        render: { minFps: 30, maxFps: 90, periodS: 7, phaseS: 4.6 },
      },
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
  "drift-fast-client": {
    ...BASE,
    name: "drift-fast-client",
    durationMs: 120_000,
    description:
      "Baseline latency, but bot-a's tick clock runs 1% fast: the input queue must hold its " +
      "depth near 0 (no ratchet toward the cap) with no client-side stall.",
    clients: [
      {
        name: "bot-a",
        behavior: { kind: "wander" },
        net: symmetric(wobble(50, 5)),
        clockScale: 1.01,
      },
      { name: "bot-b", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-c", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
    ],
  },
  "drift-slow-client": {
    ...BASE,
    name: "drift-slow-client",
    durationMs: 120_000,
    description:
      "Baseline latency, but bot-a's tick clock runs 1% slow: its snake coasts about two " +
      "ticks in a hundred, with no teleport and no worse prediction.",
    clients: [
      {
        name: "bot-a",
        behavior: { kind: "wander" },
        net: symmetric(wobble(50, 5)),
        clockScale: 0.99,
      },
      { name: "bot-b", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
      { name: "bot-c", behavior: { kind: "wander" }, net: symmetric(wobble(50, 5)) },
    ],
  },
  "render-stress-8p": {
    ...BASE,
    name: "render-stress-8p",
    tiers: [2],
    durationMs: 120_000,
    description:
      "The renderer's load test (browser tier only): one player among seven NPCs of about " +
      "300 segments each, and 400 food items: about 2,800 round things on screen at worst.",
    tunables: { npcCount: 7, startLength: 300, maxFood: 400, initialFood: 400 },
    clients: [{ name: "player", behavior: { kind: "wander" }, net: symmetric(wobble(20, 2)) }],
  },
  ...PARTY_SCENARIOS,
};

export function getScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(`unknown scenario "${name}" — known: ${Object.keys(SCENARIOS).join(", ")}`);
  }
  return scenario;
}
