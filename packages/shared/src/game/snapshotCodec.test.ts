import { describe, expect, it } from "vitest";
import type { PlayerSnap, WorldSnapshot } from "../types/game.js";
import { GAME_FOOD_WINDOW } from "../types/game.js";
import { SNAPSHOT_CODEC_VERSION, base64ToBytes, bytesToBase64 } from "./snapshotCodec.js";
import { SnapshotDecoder } from "./snapshotDecoder.js";
import { SnapshotEncoder } from "./snapshotEncoder.js";

/** A head as the sim sends it: tenths of a pixel, thousandths of a direction. */
function player(id: string, n: number, extra: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id,
    x: Math.round((100 + n * 123.456) * 10) / 10,
    y: Math.round((2300 - n * 77.7) * 10) / 10,
    dx: Math.round(Math.cos(n) * 1000) / 1000,
    dy: Math.round(Math.sin(n) * 1000) / 1000,
    len: 10 + n,
    boost: n % 2 === 1,
    ack: 1000 + n,
    ...extra,
  };
}

function snapshot(tick: number, ids: string[], extra: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    tick,
    t: 1_761_000_000_000 + tick * 50,
    players: ids.map((id, n) => player(id, n)),
    ...extra,
  };
}

interface Stream {
  encoder: SnapshotEncoder;
  /** A tick's snapshot, packed as the loop sends it. */
  tick: (s: WorldSnapshot) => string;
  /** A subscriber's seed, packed. */
  seed: (s: WorldSnapshot) => string;
}

/** One stream: an encoder, and a decoder per subscriber. */
function stream(): Stream {
  const encoder = new SnapshotEncoder();
  return {
    encoder,
    tick: (s) => bytesToBase64(encoder.encode(s)),
    seed: (s) => bytesToBase64(encoder.encodeKeyframe(s)),
  };
}

const names = (s: WorldSnapshot): string[] => s.players.map((p) => p.id).sort();

describe("snapshotCodec", () => {
  it("gives back every head exactly as the sim rounds it, and t", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    const ids = ["cmuser00000000000000000001", "npc-0", "npc-1", "guest-é"];
    decoder.decode(seed(snapshot(9, ids)));
    const sent = snapshot(10, ids);
    expect(decoder.decode(tick(sent))).toEqual(sent);
  });

  it("carries the food changes, positions in tenths of a pixel", () => {
    const { tick } = stream();
    const sent = snapshot(10, ["a"], {
      food: [
        { tick: 8, spawned: [{ id: "f12", x: 1234.5678, y: 0.04, v: 1 }] },
        { tick: 10, spawned: [{ id: "f13", x: 2400, y: 77.25, v: 2 }], eaten: ["f12", "f3"] },
        { tick: 9, eaten: ["f4294967295"] },
      ],
    });
    const decoded = new SnapshotDecoder().decode(tick(sent));
    expect(decoded.food).toEqual([
      { tick: 8, spawned: [{ id: "f12", x: 1234.6, y: 0, v: 1 }] },
      { tick: 10, spawned: [{ id: "f13", x: 2400, y: 77.3, v: 2 }], eaten: ["f12", "f3"] },
      { tick: 9, eaten: ["f4294967295"] },
    ]);
  });

  it("packs a keyframe without t, its food in one entry", () => {
    const { seed } = stream();
    const sent: WorldSnapshot = {
      tick: 3,
      players: [player("a", 0)],
      food: [{ tick: 3, spawned: [{ id: "f1", x: 10, y: 20, v: 1 }] }],
    };
    expect(new SnapshotDecoder().decode(seed(sent))).toEqual(sent);
    const empty: WorldSnapshot = { tick: 3, players: [], food: [{ tick: 3, spawned: [] }] };
    expect(new SnapshotDecoder().decode(seed(empty))).toEqual(empty);
  });

  it("names players by the keyframe alone, and introduces a new one for the window's ticks", () => {
    const { encoder, tick, seed } = stream();
    tick(snapshot(1, ["a", "b"]));
    const late = new SnapshotDecoder();
    late.decode(seed(snapshot(1, ["a", "b"])));
    for (let t = 2; t < 2 + GAME_FOOD_WINDOW; t++) tick(snapshot(t, ["a", "b"]));
    // a's and b's introductions left the window: the keyframe named them;
    // c's first snapshot introduces c
    const joined = 2 + GAME_FOOD_WINDOW;
    const first = late.decode(tick(snapshot(joined, ["a", "b", "c"])));
    expect(names(first)).toEqual(["a", "b", "c"]);

    // c is introduced in the window's ticks, from its first snapshot on, and not after
    const sizes: number[] = [];
    for (let t = joined + 1; t <= joined + GAME_FOOD_WINDOW; t++) {
      sizes.push(encoder.encode(snapshot(t, ["a", "b", "c"])).length);
    }
    const introduced = sizes[0] ?? 0;
    expect(sizes.slice(0, GAME_FOOD_WINDOW - 1)).toEqual(
      Array(GAME_FOOD_WINDOW - 1).fill(introduced),
    );
    // its index, the tick given, the id's length and its one byte
    expect(sizes.at(-1)).toBe(introduced - (2 + 4 + 1 + 1));
  });

  it("names a player who joined while up to the window's ticks were lost", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(seed(snapshot(1, ["a"])));
    decoder.decode(tick(snapshot(2, ["a"])));
    tick(snapshot(3, ["a", "b"])); // lost: b's first snapshot
    for (let t = 4; t < 2 + GAME_FOOD_WINDOW; t++) tick(snapshot(t, ["a", "b"])); // lost
    const next = decoder.decode(tick(snapshot(2 + GAME_FOOD_WINDOW, ["a", "b"])));
    expect(names(next)).toEqual(["a", "b"]);
    expect(decoder.needsKeyframe).toBe(false);
  });

  it("gives a freed index to the next player, and a decoder that lost the change names the new one", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(seed(snapshot(1, ["a", "b"])));
    decoder.decode(tick(snapshot(2, ["a", "b"])));
    tick(snapshot(3, ["a"])); // lost: b died, its index freed
    tick(snapshot(4, ["a", "c"])); // lost: c takes b's index
    const next = decoder.decode(tick(snapshot(5, ["a", "c"])));
    expect(names(next)).toEqual(["a", "c"]);
    expect(next.players.find((p) => p.id === "c")).toEqual(player("c", 1));
  });

  it("forgets its table after a longer gap in which an index was given, until a keyframe", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(seed(snapshot(1, ["a", "b"])));
    decoder.decode(tick(snapshot(2, ["a", "b"])));
    tick(snapshot(3, ["a"])); // lost
    tick(snapshot(4, ["a", "c"])); // lost: c takes b's index
    for (let t = 5; t <= 4 + GAME_FOOD_WINDOW; t++) tick(snapshot(t, ["a", "c"])); // lost
    // c's introduction left the window: b's old name must not stand for c
    const after = decoder.decode(tick(snapshot(5 + GAME_FOOD_WINDOW, ["a", "c"])));
    expect(after.players).toEqual([]);
    expect(decoder.unnamed).toBe(2);
    expect(decoder.needsKeyframe).toBe(true);

    decoder.decode(seed(snapshot(5 + GAME_FOOD_WINDOW, ["a", "c"])));
    expect(names(decoder.decode(tick(snapshot(6 + GAME_FOOD_WINDOW, ["a", "c"]))))).toEqual([
      "a",
      "c",
    ]);
    expect(decoder.needsKeyframe).toBe(false);
  });

  it("keeps its table through a longer gap whose new player the snapshot still introduces", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(seed(snapshot(1, ["a", "b"])));
    // lost: three windows of ticks, c's first snapshots at their end
    const joined = 2 + GAME_FOOD_WINDOW * 3;
    for (let t = 2; t < joined; t++) tick(snapshot(t, ["a", "b"]));
    for (let t = joined; t < joined + GAME_FOOD_WINDOW - 1; t++) tick(snapshot(t, ["a", "b", "c"]));
    const after = decoder.decode(tick(snapshot(joined + GAME_FOOD_WINDOW - 1, ["a", "b", "c"])));
    expect(names(after)).toEqual(["a", "b", "c"]);
    expect(decoder.unnamed).toBe(0);
  });

  it("lets a keyframe handled after newer snapshots name no player by an older index", () => {
    const { tick, seed } = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(seed(snapshot(1, ["a", "b"])));
    const keyframe = seed(snapshot(2, ["a", "b"])); // a resubscribe's seed, handled late
    tick(snapshot(2, ["a", "b"]));
    decoder.decode(tick(snapshot(3, ["a"])));
    decoder.decode(tick(snapshot(4, ["a", "c"]))); // c takes b's index
    decoder.decode(keyframe);
    expect(names(decoder.decode(tick(snapshot(5, ["a", "c"]))))).toEqual(["a", "c"]);
  });

  it("asks for no keyframe before its first one, which is on its way", () => {
    const { tick } = stream();
    tick(snapshot(1, ["a"]));
    const decoder = new SnapshotDecoder();
    for (let t = 2; t < 2 + GAME_FOOD_WINDOW; t++) tick(snapshot(t, ["a"]));
    // a snapshot handled before the subscription's seed: a is not introduced in it
    const early = decoder.decode(tick(snapshot(2 + GAME_FOOD_WINDOW, ["a"])));
    expect(early.players).toEqual([]);
    expect(decoder.unnamed).toBe(1);
    expect(decoder.needsKeyframe).toBe(false);
  });

  it("starts over on reset (another server's world, its ticks from 0)", () => {
    const first = stream();
    const decoder = new SnapshotDecoder();
    decoder.decode(first.seed(snapshot(500, ["a", "b"])));
    decoder.decode(first.tick(snapshot(501, ["a", "b"])));
    decoder.reset();
    const second = stream();
    decoder.decode(second.seed(snapshot(0, ["c"])));
    expect(names(decoder.decode(second.tick(snapshot(1, ["c", "d"]))))).toEqual(["c", "d"]);
  });

  it("packs a snapshot into less than half of its JSON, base64 and all", () => {
    const { tick, seed } = stream();
    const ids = ["cmuser00000000000000000001", "cmuser00000000000000000002", "npc-0", "npc-1"];
    seed(snapshot(1, ids));
    for (let t = 2; t < 2 + GAME_FOOD_WINDOW; t++) tick(snapshot(t, ids));
    const sent = snapshot(2 + GAME_FOOD_WINDOW, ids, {
      food: [{ tick: 2 + GAME_FOOD_WINDOW, spawned: [{ id: "f99", x: 120.5, y: 33.3, v: 1 }] }],
    });
    const json = JSON.stringify(sent).length;
    const packed = JSON.stringify({ b: tick(sent) }).length;
    expect(packed).toBeLessThan(json / 2);
  });

  it("refuses another layout version, and a food id it cannot pack", () => {
    const bytes = new SnapshotEncoder().encode(snapshot(1, ["a"]));
    bytes[0] = SNAPSHOT_CODEC_VERSION + 1;
    expect(() => new SnapshotDecoder().decode(bytes)).toThrow(/version/);
    expect(() =>
      new SnapshotEncoder().encode(snapshot(1, ["a"], { food: [{ tick: 1, eaten: ["apple"] }] })),
    ).toThrow(/food id/);
  });

  it("round-trips bytes through base64", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
