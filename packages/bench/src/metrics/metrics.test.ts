import { describe, expect, it } from "vitest";
import { getScenario } from "../scenarios.js";
import type { ClientTrace, ServerTick, ServerTrace } from "../types.js";
import { computeStats, sampleTrack, buildDiscontinuityMask } from "./tracks.js";
import { computeDivergence } from "./divergence.js";
import { computeFood } from "./food.js";
import { computeScorecard, headlineMetrics } from "./index.js";
import { computeInputQueue } from "./inputQueue.js";
import { computePacketHealth } from "./packets.js";

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
  return { clientId, kind: "bot" as const, frames, snapshots: [], corrections: [], inputs: [] };
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
    const stale: ClientTrace = { ...client, food: { tick: 7, latestTick: 7, ids: [], resyncs: 0 } };
    expect(computeFood(stale, server)).toEqual({ foodResyncs: 0 });
    expect(computeFood(client, server)).toEqual({});
  });
});

describe("headlineMetrics", () => {
  const scenario = { ...getScenario("control-0ms"), warmupMs: 0 };
  const meta = { tier: 1 as const, gitCommit: "test", branch: "test" };

  it("gates on the worst client's food, once the card carries it", () => {
    const server: ServerTrace = { ...makeServerTrace(), food: [{ tick: 100, ids: ["a"] }] };
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
});
