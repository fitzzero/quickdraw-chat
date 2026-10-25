import { describe, expect, it } from "vitest";
import { getScenario } from "../scenarios.js";
import type { ClientReport, ClientTrace, ServerTick, ServerTrace, Stats } from "../types.js";
import { computeStats, sampleTrack, buildDiscontinuityMask } from "./tracks.js";
import { computeDivergence } from "./divergence.js";
import { computeFood } from "./food.js";
import { compareScorecards } from "../compare.js";
import {
  aggregateScorecards,
  computeScorecard,
  headlineMetrics,
  middleOf,
  partyFairness,
} from "./index.js";
import { computeInputQueue, computeOwnQueue } from "./inputQueue.js";
import { computePacketHealth } from "./packets.js";
import { STEP_CORRECTION_PX, computeSmoothness } from "./smoothness.js";

function makeServerTrace(): ServerTrace {
  // Entity "e1" moves +10px/tick along x for 100 ticks at 50ms
  const ticks = Array.from({ length: 100 }, (_, i) => ({
    tick: i + 1,
    tWall: 1000 + i * 50,
    tickDurMs: 0.1,
    snapshotBytes: 100,
    players: [{ id: "e1", x: (i + 1) * 10, y: 0 }],
    inputs: [],
  }));
  return { ticks, deaths: [] };
}

function makeClientTrace(clientId: string, offsetPx: number): ClientTrace {
  // 60Hz frames rendering e1 with a fixed positional offset
  const frames = Array.from({ length: 300 }, (_, i) => {
    const t = 1000 + i * (50 / 3);
    const serverX = ((t - 1000) / 50 + 1) * 10;
    return { tWall: t, entities: { e1: { x: serverX + offsetPx, y: 0 } } };
  });
  return {
    clientId,
    kind: "bot" as const,
    frames,
    snapshots: [],
    corrections: [],
    inputs: [],
  };
}

describe("computeStats", () => {
  it("computes percentiles on sorted values", () => {
    const stats = computeStats(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(stats.n).toBe(100);
    expect(stats.p50).toBe(51);
    expect(stats.p95).toBe(96);
    expect(stats.max).toBe(100);
  });

  it("handles empty input", () => {
    expect(computeStats([]).n).toBe(0);
  });
});

describe("sampleTrack", () => {
  const track = { t: [0, 100, 200], x: [0, 10, 20], y: [0, 0, 0] };

  it("interpolates linearly between samples", () => {
    expect(sampleTrack(track, 50)?.x).toBeCloseTo(5);
    expect(sampleTrack(track, 150)?.x).toBeCloseTo(15);
  });

  it("returns null out of range and across gaps", () => {
    expect(sampleTrack(track, -1)).toBeNull();
    expect(sampleTrack(track, 201)).toBeNull();
    const gappy = { t: [0, 500], x: [0, 10], y: [0, 0] };
    expect(sampleTrack(gappy, 250)).toBeNull();
  });
});

describe("computeDivergence", () => {
  it("measures the offset between two clients' views of the same entity", () => {
    const server = makeServerTrace();
    // Neither client owns e1 → remoteVsRemote
    const a = makeClientTrace("a", 0);
    const b = makeClientTrace("b", 7);
    const result = computeDivergence([a, b], server, 1500, 5500);
    expect(result.remoteVsRemotePx.p50).toBeCloseTo(7, 0);
    expect(result.ownVsRemotePx.n).toBe(0);
  });

  it("classifies the owner's view as ownVsRemote", () => {
    const server = makeServerTrace();
    const a = { ...makeClientTrace("a", 0), playerId: "e1" };
    const b = makeClientTrace("b", 3);
    const result = computeDivergence([a, b], server, 1500, 5500);
    expect(result.ownVsRemotePx.p50).toBeCloseTo(3, 0);
    expect(result.remoteVsRemotePx.n).toBe(0);
  });
});

describe("buildDiscontinuityMask", () => {
  it("masks around deaths and respawn appearances", () => {
    const server = makeServerTrace();
    server.deaths.push({ tick: 50, tWall: 3450, id: "e1" });
    const masked = buildDiscontinuityMask(server);
    expect(masked("e1", 3450)).toBe(true);
    expect(masked("e1", 3450 + 699)).toBe(true);
    expect(masked("e1", 3450 + 800)).toBe(false);
    // First appearance at trace start is masked too
    expect(masked("e1", 1000)).toBe(true);
  });
});

describe("computePacketHealth", () => {
  it("derives gapRate from tick numbering", () => {
    const trace: ClientTrace = {
      clientId: "a",
      kind: "bot",
      frames: [],
      corrections: [],
      inputs: [
        { seq: 1, tSent: 1000, tAcked: 1080 },
        { seq: 2, tSent: 1050 },
      ],
      // ticks 1,2,4 → one missed tick out of 3 tick-steps
      snapshots: [
        { tWall: 1000, tick: 1 },
        { tWall: 1050, tick: 2 },
        { tWall: 1150, tick: 4 },
      ],
    };
    const health = computePacketHealth(trace, 900, 1300);
    expect(health.gapRate).toBeCloseTo(1 / 3);
    expect(health.maxConsecutiveMissedTicks).toBe(1);
    expect(health.inputAckRttMs.p50).toBe(80);
  });
});

describe("computeInputQueue", () => {
  /** 60 s of ticks at 20 Hz; `entry(i)` is each tick's accounting of one snake. */
  function ticksOf(entry: (i: number) => { stepped: number; depth: number }): ServerTick[] {
    return Array.from({ length: 1200 }, (_, i) => ({
      tick: i + 1,
      tWall: 1000 + i * 50,
      tickDurMs: 0.1,
      snapshotBytes: 100,
      players: [],
      inputs: [
        { id: "p1", ...entry(i) },
        { id: "p2", stepped: 1, depth: 0 },
      ],
    }));
  }

  it("counts starved and catch-up ticks per snake, and across them", () => {
    // p1 starves one tick in a hundred and steps two on the next
    const ticks = ticksOf((i) => ({
      stepped: i % 100 === 0 ? 0 : i % 100 === 1 ? 2 : 1,
      depth: 0,
    }));
    const own = computeInputQueue(ticks, "p1");
    expect(own?.starvedRate).toBeCloseTo(0.01, 5);
    expect(own?.multiStepRate).toBeCloseTo(0.01, 5);
    expect(own?.depthP95).toBe(0);
    expect(computeInputQueue(ticks)?.starvedRate).toBeCloseTo(0.005, 5);
    expect(computeInputQueue(ticks, "nobody")).toBeUndefined();
  });

  it("reports a queue that grows over the run as a depth trend", () => {
    // p1's depth climbs one frame every 10 s
    const ticks = ticksOf((i) => ({ stepped: 1, depth: Math.floor(i / 200) }));
    const own = computeInputQueue(ticks, "p1");
    expect(own?.depthTrend).toBeGreaterThan(4);
    expect(own?.depthP95).toBe(5);
    expect(computeInputQueue(ticks, "p2")?.depthTrend).toBe(0);
  });

  it("counts the ticks where the ack moved by other than the steps, once the trace has acks", () => {
    // p1 over 60 s: a coast (ack +1) and a two-step tick (ack +2) agree; a
    // tick where the ack stood still and one where it skipped a frame do not
    const stepped = (i: number): number => (i === 10 ? 0 : i === 20 ? 2 : 1);
    const ackDelta = (i: number): number =>
      i === 25 ? 0 : i === 40 ? 2 : i === 10 ? 1 : stepped(i);
    let ack = 0;
    const ticks = ticksOf((i) => ({ stepped: stepped(i), depth: 0 })).map((tick, i) => {
      ack += ackDelta(i);
      // p2 is in every snapshot without an ack, as a trace from before the check
      return {
        ...tick,
        players: [
          { id: "p1", x: 0, y: 0, ack },
          { id: "p2", x: 0, y: 0 },
        ],
      };
    });
    // a tick p1 was not fed on breaks the chain: the next tick's delta (two,
    // over the gap) is not judged
    const unfed = ticks.map((tick, i) =>
      i === 50 ? { ...tick, inputs: tick.inputs.filter((e) => e.id !== "p1") } : tick,
    );
    expect(computeInputQueue(unfed, "p1")?.stepAckMismatchPerMin).toBeCloseTo(
      2 / ((1199 * 50) / 60_000),
      5,
    );
    // a tick the snapshot left p1 out of (it died stepping) breaks the chain
    // the same way, and keeps the metric
    const died = unfed.map((tick, i) => (i === 70 ? { ...tick, players: [] } : tick));
    expect(computeInputQueue(died, "p1")?.stepAckMismatchPerMin).toBeCloseTo(
      2 / ((1199 * 50) / 60_000),
      5,
    );
    // p2 has no ack in the trace: the metric is left out, not zero
    expect(computeInputQueue(unfed, "p2")?.stepAckMismatchPerMin).toBeUndefined();
    expect(computeInputQueue(unfed)?.stepAckMismatchPerMin).toBeUndefined();
  });

  it("counts a client's nudges of its frame clock a minute, within the window", () => {
    const ticks = ticksOf(() => ({ stepped: 1, depth: 0 }));
    const client = { ...makeClientTrace("c1", 0), playerId: "p1" };
    // three nudges in the 60 s window, one before it
    client.nudges = [500, 2000, 30_000, 59_000].map((tWall) => ({ tWall }));
    expect(computeOwnQueue(ticks, client)?.nudgesPerMin).toBeCloseTo(3 / ((1200 * 50) / 60_000), 5);
    // a trace without nudges (older, or a browser's) leaves the metric out
    expect(computeOwnQueue(ticks, makeClientTrace("c2", 0))).toBeUndefined();
    expect(
      computeOwnQueue(ticks, { ...makeClientTrace("c3", 0), playerId: "p2" })?.nudgesPerMin,
    ).toBeUndefined();
  });
});

describe("computeSmoothness", () => {
  it("counts the corrections of a whole movement step a minute", () => {
    const server = makeServerTrace();
    const client = makeClientTrace("c1", 0);
    // the window is the server's 5 s: six corrections, three of them a step or more
    client.corrections = [0.3, 4.4, STEP_CORRECTION_PX - 0.01, STEP_CORRECTION_PX, 9, 16].map(
      (magnitudePx, i) => ({
        tWall: 1100 + i * 500,
        magnitudePx,
        hard: false,
      }),
    );
    const report = computeSmoothness(client, server, 1000, 1000 + 99 * 50);
    expect(report.stepCorrectionsPerMin).toBeCloseTo(3 / ((99 * 50) / 60_000), 5);
    expect(report.correctionPx.n).toBe(6);
  });
});

describe("computeFood", () => {
  const server: ServerTrace = {
    ...makeServerTrace(),
    food: [
      { tick: 99, ids: ["a", "b"] },
      { tick: 100, ids: ["a", "c"] },
    ],
  };
  const client = makeClientTrace("c1", 0);
  const held = (tick: number, ids: string[], resyncs = 0): ClientTrace => ({
    ...client,
    food: { tick, latestTick: 100, ids, resyncs },
  });

  it("counts the food ids a client and the server disagree on at its latest snapshot", () => {
    expect(computeFood(held(100, ["a", "c"]), server)).toEqual({
      foodMismatchAtEnd: 0,
      foodResyncs: 0,
    });
    // a ghost (b, eaten on the server) and a miss (c)
    expect(computeFood(held(100, ["a", "b"], 1), server)).toEqual({
      foodMismatchAtEnd: 2,
      foodResyncs: 1,
    });
  });

  it("counts what a client stuck at an older tick lacks", () => {
    // right as of tick 99, but its latest snapshot is tick 100's
    expect(computeFood(held(99, ["a", "b"], 1), server).foodMismatchAtEnd).toBe(2);
  });

  it("reports no mismatch without the server's food at that tick, and nothing without food", () => {
    const stale: ClientTrace = {
      ...client,
      food: { tick: 7, latestTick: 7, ids: [], resyncs: 0 },
    };
    expect(computeFood(stale, server)).toEqual({ foodResyncs: 0 });
    expect(computeFood(client, server)).toEqual({});
  });
});

describe("headlineMetrics", () => {
  const scenario = { ...getScenario("control-0ms"), warmupMs: 0 };
  const meta = { tier: 1 as const, gitCommit: "test", branch: "test" };

  it("gates on the worst client's food, once the card carries it", () => {
    const server: ServerTrace = {
      ...makeServerTrace(),
      food: [{ tick: 100, ids: ["a"] }],
    };
    const fed = (clientId: string, ids: string[]): ClientTrace => ({
      ...makeClientTrace(clientId, 0),
      food: { tick: 100, latestTick: 100, ids, resyncs: 0 },
    });
    const card = computeScorecard(
      { server, clients: [fed("c1", ["a"]), fed("c2", ["b", "c"])] },
      scenario,
      meta,
    );
    expect(headlineMetrics(card)["food.mismatchAtEnd"]).toBe(3);
    const bare = computeScorecard(
      { server: makeServerTrace(), clients: [makeClientTrace("c1", 0)] },
      scenario,
      meta,
    );
    expect(headlineMetrics(bare)).not.toHaveProperty(["food.mismatchAtEnd"]);
  });

  it("fails a card whose ack parted from the steps, and headlines the worst client's step corrections", () => {
    // e1 is a fed human snake whose ack counts its steps, but for one tick
    const traceWith = (mismatch: boolean): ServerTrace => ({
      ...makeServerTrace(),
      ticks: makeServerTrace().ticks.map((tick, i) => ({
        ...tick,
        players: [
          {
            id: "e1",
            x: (i + 1) * 10,
            y: 0,
            ack: mismatch && i >= 50 ? i : i + 1,
          },
        ],
        inputs: [{ id: "e1", stepped: 1, depth: 0 }],
      })),
    });
    const corrected = (clientId: string, magnitudes: number[]): ClientTrace => ({
      ...makeClientTrace(clientId, 0),
      playerId: clientId === "c1" ? "e1" : undefined,
      corrections: magnitudes.map((magnitudePx, i) => ({
        tWall: 1100 + i * 100,
        magnitudePx,
        hard: false,
      })),
    });
    const clean = computeScorecard(
      {
        server: traceWith(false),
        clients: [corrected("c1", [0.2]), corrected("c2", [9, 9])],
      },
      scenario,
      meta,
    );
    const minutes = (99 * 50) / 60_000;
    expect(headlineMetrics(clean)["server.inputQueue.stepAckMismatchPerMin"]).toBe(0);
    expect(headlineMetrics(clean)["smoothness.stepCorrectionsPerMin"]).toBeCloseTo(2 / minutes, 5);
    const parted = computeScorecard(
      {
        server: traceWith(true),
        clients: [corrected("c1", []), corrected("c2", [])],
      },
      scenario,
      meta,
    );
    // the queue's minutes are its fed ticks (100 of them), the window's its span
    expect(headlineMetrics(parted)["server.inputQueue.stepAckMismatchPerMin"]).toBeCloseTo(
      1 / ((100 * 50) / 60_000),
      5,
    );
    expect(compareScorecards(clean, clean).failed).toBe(false);
    const verdict = compareScorecards(clean, parted);
    expect(verdict.failed).toBe(true);
    expect(
      verdict.comparisons.find((c) => c.metric === "server.inputQueue.stepAckMismatchPerMin")
        ?.verdict,
    ).toBe("fail");
    // a baseline from before the check carries neither metric; the candidate's still gate
    const before = computeScorecard(
      { server: makeServerTrace(), clients: [makeClientTrace("c1", 0)] },
      scenario,
      meta,
    );
    expect(headlineMetrics(before)).not.toHaveProperty(["server.inputQueue.stepAckMismatchPerMin"]);
    expect(compareScorecards(before, parted).failed).toBe(true);
  });

  it("keeps each metric's worst run in an aggregated card, which the food gate judges", () => {
    const server: ServerTrace = {
      ...makeServerTrace(),
      food: [{ tick: 100, ids: ["a"] }],
    };
    const ids = ["c1", "c2", "c3"];
    const run = (wrong: string | null) =>
      computeScorecard(
        {
          server,
          clients: ids.map((id) => ({
            ...makeClientTrace(id, 0),
            food: {
              tick: 100,
              latestTick: 100,
              ids: id === wrong ? [] : ["a"],
              resyncs: 0,
            },
          })),
        },
        scenario,
        meta,
      );
    // each run, another client lost a change: every client's median is 0
    const lossy = aggregateScorecards(ids.map(run));
    expect(headlineMetrics(lossy)["food.mismatchAtEnd"]).toBe(0);
    expect(lossy.runWorst?.["food.mismatchAtEnd"]).toBe(1);
    const clean = aggregateScorecards([run(null), run(null), run(null)]);
    expect(compareScorecards(clean, lossy).failed).toBe(true);
    expect(compareScorecards(clean, clean).failed).toBe(false);
  });
});

/** Stats of `n` samples, all at `value`. */
function flat(value: number, n = 10): Stats {
  return { n, mean: value, p50: value, p95: value, max: value };
}

/** A client report holding what a party's fairness reads: its ack times and its prediction error. */
function partyClient(ackMs: number, predictionPx: number | null, acks = 10): ClientReport {
  const stats = flat(0);
  return {
    kind: "bot",
    packet: {
      interArrivalMs: stats,
      effectiveRate: 20,
      gapRate: 0,
      maxConsecutiveMissedTicks: 0,
      inputAckRttMs: flat(ackMs, acks),
    },
    smoothness: {
      teleportsPerMin: 0,
      jerkRms: 0,
      hardSnapsPerMin: 0,
      correctionPx: stats,
    },
    perEntity: {},
    ...(predictionPx === null ? {} : { predictionErrorPx: flat(predictionPx) }),
    effectiveFps: 60,
  };
}

describe("partyFairness", () => {
  it("sets the host's own user against the other players' median, the middle two's mean when even", () => {
    const fairness = partyFairness("host", {
      host: partyClient(140, 15),
      a: partyClient(150, 16),
      b: partyClient(160, 18),
      c: partyClient(130, 14),
      d: partyClient(170, 20),
    });
    expect(fairness).toEqual({
      host: "host",
      inputAckRttP50: { host: 140, peers: 155 },
      predictionErrorP95: { host: 15, peers: 17 },
    });
  });

  it("leaves out what a client did not measure, and says NaN when no client did", () => {
    const fairness = partyFairness("host", {
      host: partyClient(0, null, 0),
      a: partyClient(150, null),
      spectator: partyClient(0, null, 0),
    });
    expect(fairness.inputAckRttP50).toEqual({ host: Number.NaN, peers: 150 });
    expect(fairness.predictionErrorP95).toEqual({
      host: Number.NaN,
      peers: Number.NaN,
    });
    expect(middleOf([Number.NaN, 3, 1, 2])).toBe(2);
  });
});
