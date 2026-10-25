import type { GameDeathEvent, GamePlayerMeta, GameWire, WorldSnapshot } from "@project/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYFRAME_TIMEOUT_MS, PartyTransport } from "../wire/partyTransport";

const WORLD = "party-1";
const BOUNDS = { w: 2400, h: 2400 };

interface Recorder extends GameWire {
  followed: string[];
  snapshots: WorldSnapshot[];
  keyframes: WorldSnapshot[];
  deaths: GameDeathEvent[];
  gone: string[];
}

function recorder(): Recorder {
  const r: Recorder = {
    followed: [],
    snapshots: [],
    keyframes: [],
    deaths: [],
    gone: [],
    follow: (serverId) => r.followed.push(serverId),
    snapshot: (snapshot) => r.snapshots.push(snapshot),
    keyframe: (keyframe) => r.keyframes.push(keyframe),
    death: (death) => r.deaths.push(death),
    left: (id) => r.gone.push(id),
  };
  return r;
}

const keyframe = (tick: number): WorldSnapshot => ({
  tick,
  players: [],
  food: [{ tick, spawned: [{ id: "f1", x: 1, y: 2, v: 1 }] }],
});
const snapshot = (tick: number): WorldSnapshot => ({ tick, t: tick * 50, players: [] });

async function started(
  onPlayer?: (meta: GamePlayerMeta) => void,
): Promise<{ transport: PartyTransport; wire: Recorder }> {
  const transport = new PartyTransport({
    worldId: WORLD,
    bounds: BOUNDS,
    ...(onPlayer ? { onPlayer } : {}),
  });
  const wire = recorder();
  await transport.start(wire);
  return { transport, wire };
}

describe("PartyTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins nothing itself: the page did; it answers the bounds and follows the party's host once", async () => {
    const { transport, wire } = await started();
    expect(await transport.start(wire)).toEqual({ bounds: BOUNDS });
    expect(wire.followed).toEqual(["party:party-1", "party:party-1"]);
    expect(transport.needsKeyframe).toBe(false);
  });

  it("takes the first item of a fresh list, and any item without a send time, as a keyframe", async () => {
    const { transport, wire } = await started();
    transport.item(keyframe(10), true);
    transport.item(snapshot(11), false);
    transport.item(snapshot(12), false);
    // a new link's seed: its first item is a keyframe again, its tick older than the newest snapshot
    transport.item(keyframe(12), true);
    // a keyframe the bridge did not flag still has no send time
    transport.item(keyframe(13), false);
    expect(wire.keyframes.map((k) => k.tick)).toEqual([10, 12, 13]);
    expect(wire.snapshots.map((s) => s.tick)).toEqual([11, 12]);
  });

  it("routes the party's events as the world's", async () => {
    const players: GamePlayerMeta[] = [];
    const { transport, wire } = await started((meta) => players.push(meta));
    transport.event({ kind: "joined", id: "p2", name: "Bo", hue: 120 });
    transport.event({ kind: "death", id: "p2", len: 7 });
    transport.event({ kind: "left", id: "p2" });
    transport.event({ kind: "leaderboard", entries: [], rttMs: {}, fairLinkMs: null });
    expect(players).toEqual([{ id: "p2", name: "Bo", hue: 120 }]);
    expect(wire.deaths).toEqual([{ id: "p2", len: 7 }]);
    expect(wire.gone).toEqual(["p2"]);
  });

  it("sends input through the bridge's channel while it is ready, and drops it otherwise", async () => {
    const { transport } = await started();
    const sent: unknown[] = [];
    const frames = [{ seq: 1, dx: 1, dy: 0, boost: false }];
    transport.sendInput(frames);
    transport.attach({ send: null, reseed: () => undefined });
    transport.sendInput(frames);
    transport.attach({ send: (payload) => sent.push(payload), reseed: () => undefined });
    transport.sendInput(frames);
    transport.detach();
    transport.sendInput(frames);
    expect(sent).toEqual([{ frames }]);
  });

  it("asks the bridge for a fresh seed and resolves on the keyframe it brings", async () => {
    const { transport, wire } = await started();
    let reseeds = 0;
    transport.attach({ send: null, reseed: () => (reseeds += 1) });
    let resolved = false;
    const ask = transport.requestKeyframe().then(() => {
      resolved = true;
    });
    expect(reseeds).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);
    transport.item(keyframe(20), true);
    await ask;
    expect(resolved).toBe(true);
    expect(wire.keyframes.map((k) => k.tick)).toEqual([20]);
  });

  it("gives up on a keyframe that does not come, so the next gap asks again", async () => {
    const { transport } = await started();
    let resolved = false;
    void transport.requestKeyframe().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(KEYFRAME_TIMEOUT_MS - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
  });

  it("hands nothing on once closed", async () => {
    const { transport, wire } = await started();
    transport.close();
    transport.item(keyframe(1), true);
    transport.item(snapshot(2), false);
    transport.event({ kind: "left", id: "p2" });
    expect(wire.keyframes).toEqual([]);
    expect(wire.snapshots).toEqual([]);
    expect(wire.gone).toEqual([]);
  });
});
