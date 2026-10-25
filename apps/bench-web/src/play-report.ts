/**
 * What `bench:play` makes of a session (probe-live.ts): the packed world
 * stream decoded in arrival order, the player's own ack deltas, the frame
 * and send gaps, the long tasks and the renderer's stats line, and the
 * shapes a stall takes, each a failure of the deploy check. Everything is
 * judged from `since`: the moment the player was in the world plus a settle
 * second, so the page's load, the sign-in and the renderer's first builds
 * are not the deploy's stalls.
 */

import {
  acceptanceFor,
  computeStats,
  displayRateOf,
  type Stats,
  type Tier2Acceptance,
} from "@project/bench";
import { SnapshotDecoder, type WorldSnapshot } from "@project/shared";

/** A main-thread task this long is a stall the player felt (the longtask observer's own threshold). */
export const LONG_TASK_MS = 50;
/** The renderer may build its geometry (the grid, the textures) within this long of the player's entry. */
export const SETTLE_MS = 1000;

export interface CliArgs {
  url: string;
  seconds: number;
  name: string;
  gpu?: "webgl" | "webgpu";
  windowPosition?: string;
  headless: boolean;
}

/** One message of the world stream (`b`), a seed from a subscription's reply, a hello, or a game event. */
export interface WireRecord {
  t: number;
  b?: string;
  seed?: boolean;
  hello?: { userId: string | null; serverId: string | null };
  event?: string;
  id?: string | null;
  n?: number;
}

export interface PageSamples {
  wire: WireRecord[];
  sends: { t: number; seq: number | null }[];
  raf: { t: number; gap: number }[];
  longTasks: { t: number; d: number }[];
  sockets: {
    id: number;
    url: string;
    openedAt: number | null;
    closedAt: number | null;
    code: number | null;
  }[];
}

/** The page's stats line (`?debug=1`): backend, fps, work, draws, builds, tick. */
export interface StatsSample {
  t: number;
  backend: string;
  fps: number;
  drawCalls: number | null;
  geometryBuilds: number;
  tick: number;
}

interface Decoded {
  t: number;
  tick: number;
  seed: boolean;
  ownAck: number | null;
}

interface WireAnalysis {
  userId: string | null;
  serverIds: string[];
  arrivals: Decoded[];
  undecodable: number;
  arrivalGaps: Stats;
  over100: number;
  missedTicks: number;
  perSecond: number;
  acks: Map<string, number>;
}

interface PageAnalysis {
  raf: Stats;
  hz: number | null;
  acceptance: Tier2Acceptance;
  rafStalls: number;
  sends: number;
  sendGaps: Stats;
  longTasks: { t: number; d: number }[];
  backend: string;
  draws: Stats;
  buildsFirst: number | null;
  buildsLast: number | null;
  buildsAfterSettle: number;
  opened: number;
  closed: number;
}

/** Decodes the stream in arrival order (a new server's hello starts the id table over). */
function decodeWire(wire: WireRecord[]): {
  userId: string | null;
  serverIds: string[];
  snapshots: Decoded[];
  undecodable: number;
} {
  const decoder = new SnapshotDecoder();
  let userId: string | null = null;
  const serverIds: string[] = [];
  const snapshots: Decoded[] = [];
  let undecodable = 0;
  for (const record of wire) {
    if (record.hello) {
      if (record.hello.userId !== null) userId = record.hello.userId;
      if (record.hello.serverId !== null && serverIds.at(-1) !== record.hello.serverId) {
        serverIds.push(record.hello.serverId);
        decoder.reset();
      }
      continue;
    }
    if (record.b === undefined) continue;
    let snapshot: WorldSnapshot;
    try {
      snapshot = decoder.decode(record.b);
    } catch {
      undecodable += 1;
      continue;
    }
    snapshots.push({
      t: record.t,
      tick: snapshot.tick,
      seed: record.seed === true,
      ownAck: ownAckOf(snapshot, userId),
    });
  }
  return { userId, serverIds, snapshots, undecodable };
}

/** The player's own `ack` in a snapshot, null while the snake is not in it. */
function ownAckOf(snapshot: WorldSnapshot, userId: string | null): number | null {
  if (userId === null) return null;
  const own = snapshot.players.find((p) => p.id === userId);
  return own === undefined ? null : own.ack;
}

function gaps(times: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const prev = times[i - 1];
    const cur = times[i];
    if (prev !== undefined && cur !== undefined) out.push(cur - prev);
  }
  return out;
}

function ackBucket(delta: number): string {
  if (delta === 0) return "0";
  if (delta === 1) return "+1";
  if (delta === 2) return "+2";
  return delta > 2 ? "+3 or more" : "backwards";
}

/**
 * Consecutive snapshots that both hold the player's snake, once a frame of
 * its was stepped (the ack stays 0 from the spawn to the first frame): how
 * far the ack moved.
 */
function ackDeltas(snapshots: Decoded[]): Map<string, number> {
  const histogram = new Map<string, number>([
    ["0", 0],
    ["+1", 0],
    ["+2", 0],
    ["+3 or more", 0],
    ["backwards", 0],
  ]);
  let previous: number | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.seed) continue;
    if (snapshot.ownAck === null) {
      previous = null;
      continue;
    }
    if (previous !== null && previous > 0) {
      const key = ackBucket(snapshot.ownAck - previous);
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    previous = snapshot.ownAck;
  }
  return histogram;
}

function analyzeWire(samples: PageSamples, since: number): WireAnalysis {
  const { userId, serverIds, snapshots, undecodable } = decodeWire(samples.wire);
  const arrivals = snapshots.filter((s) => !s.seed && s.t >= since);
  const times = arrivals.map((s) => s.t);
  const arrivalGaps = gaps(times);
  const first = times[0];
  const last = times.at(-1);
  const seconds = first === undefined || last === undefined ? 0 : (last - first) / 1000;
  return {
    userId,
    serverIds,
    arrivals,
    undecodable,
    arrivalGaps: computeStats(arrivalGaps),
    over100: arrivalGaps.filter((g) => g > 100).length,
    missedTicks: gaps(arrivals.map((s) => s.tick)).reduce((sum, g) => sum + Math.max(0, g - 1), 0),
    perSecond: seconds > 0 ? arrivals.length / seconds : 0,
    acks: ackDeltas(arrivals),
  };
}

/** The game's sockets: the dev server's own (`/_next/`) are not the deploy's. */
function gameSockets(samples: PageSamples): PageSamples["sockets"] {
  return samples.sockets.filter((s) => !s.url.includes("/_next/"));
}

function analyzePage(samples: PageSamples, stats: StatsSample[], since: number): PageAnalysis {
  const raf = computeStats(samples.raf.filter((r) => r.t >= since).map((r) => r.gap));
  const hz = raf.n > 0 && raf.p50 > 0 ? Math.round(1000 / raf.p50) : null;
  const settled = stats.filter((s) => s.t >= since);
  const settledFirst = settled[0];
  const settledLast = settled.at(-1);
  const sends = samples.sends.filter((s) => s.t >= since);
  const sockets = gameSockets(samples);
  return {
    raf,
    hz,
    acceptance: acceptanceFor(displayRateOf(hz ?? 60)),
    rafStalls: samples.raf.filter((r) => r.t >= since && r.gap >= LONG_TASK_MS).length,
    sends: sends.length,
    sendGaps: computeStats(gaps(sends.map((s) => s.t))),
    longTasks: samples.longTasks.filter((t) => t.t >= since && t.d >= LONG_TASK_MS),
    backend: stats.at(-1)?.backend ?? "unknown",
    draws: computeStats(stats.flatMap((s) => (s.drawCalls === null ? [] : [s.drawCalls]))),
    buildsFirst: stats[0]?.geometryBuilds ?? null,
    buildsLast: stats.at(-1)?.geometryBuilds ?? null,
    buildsAfterSettle:
      settledFirst === undefined || settledLast === undefined
        ? 0
        : settledLast.geometryBuilds - settledFirst.geometryBuilds,
    opened: sockets.filter((s) => s.openedAt !== null).length,
    closed: sockets.filter((s) => s.closedAt !== null && s.closedAt >= since).length,
  };
}

const fmt = (stats: Stats): string =>
  `p50 ${stats.p50.toFixed(1)} / p95 ${stats.p95.toFixed(1)} / p99 ${stats.p99.toFixed(1)} / max ${stats.max.toFixed(1)} ms`;
const orNa = (value: number | null): string => (value === null ? "n/a" : String(value));

function wireLines(wire: WireAnalysis, page: PageAnalysis): string[] {
  return [
    `  sockets: ${page.opened} opened over the session (the guest sign-in connects again), ${page.closed} closed while playing; servers seen: ${wire.serverIds.length}; player ${wire.userId ?? "unknown"}`,
    `  snapshots: ${wire.arrivals.length} (${wire.perSecond.toFixed(1)}/s), arrival gap ${fmt(wire.arrivalGaps)}, over 100 ms: ${wire.over100}, ticks missed: ${wire.missedTicks}, undecodable: ${wire.undecodable}`,
    `  own ack deltas: ${[...wire.acks.entries()].map(([k, v]) => `${k} ×${v}`).join(", ")} (healthy: all +1, the odd +2)`,
  ];
}

function pageLines(page: PageAnalysis): string[] {
  const { acceptance, raf } = page;
  const pacing =
    raf.p95 <= acceptance.frameTimeP95Ms && raf.p99 <= acceptance.frameTimeP99Ms ? "✓" : "✗";
  const tasks = page.longTasks.map((t) => `${t.d.toFixed(0)} ms`).join(", ");
  return [
    `  rAF gaps: ${fmt(raf)} (acceptance at ${acceptance.hz} Hz: p95 ${acceptance.frameTimeP95Ms}, p99 ${acceptance.frameTimeP99Ms}) ${pacing}; gaps of ${LONG_TASK_MS} ms or more: ${page.rafStalls}`,
    `  long tasks: ${page.longTasks.length}${tasks === "" ? "" : ` (${tasks})`}`,
    `  input sends: ${page.sends}, gap p95 ${page.sendGaps.p95.toFixed(0)} ms, max ${page.sendGaps.max.toFixed(0)} ms`,
    `  renderer: ${page.backend}, draw calls p50 ${page.draws.n > 0 ? page.draws.p50.toFixed(0) : "n/a"}, geometry builds ${orNa(page.buildsFirst)} → ${orNa(page.buildsLast)}, ${page.buildsAfterSettle} built after the first second`,
  ];
}

/** The shapes a stall takes, each a failure of the deploy check. */
function failuresOf(wire: WireAnalysis, page: PageAnalysis): string[] {
  const failures: string[] = [];
  if (page.longTasks.length > 0) failures.push(`${page.longTasks.length} long task(s)`);
  if (page.buildsAfterSettle > 0) {
    failures.push(`${page.buildsAfterSettle} geometry build(s) after the first second`);
  }
  const zeros = wire.acks.get("0") ?? 0;
  if (zeros > 0) failures.push(`${zeros} ack delta(s) of 0`);
  if (wire.arrivals.length === 0) failures.push("no snapshot decoded");
  return failures;
}

/** Prints the report, judged from `since` (epoch ms); true when the deploy check passed. */
export function report(
  args: CliArgs,
  samples: PageSamples,
  stats: StatsSample[],
  since: number,
): boolean {
  const wire = analyzeWire(samples, since);
  const page = analyzePage(samples, stats, since);
  const failures = failuresOf(wire, page);
  const title = `bench:play — ${args.url} as "${args.name}", ${args.seconds} s, ${page.backend}${page.hz === null ? "" : ` at ~${page.hz} Hz`}`;
  const verdict =
    failures.length === 0 ? "  RESULT: PASS" : `  RESULT: FAIL (${failures.join("; ")})`;
  console.log([title, ...wireLines(wire, page), ...pageLines(page), verdict].join("\n"));
  return failures.length === 0;
}
