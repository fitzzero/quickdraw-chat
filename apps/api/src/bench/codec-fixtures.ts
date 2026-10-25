/**
 * The packed snapshots check:godot hands the GDScript decoder
 * (apps/game/godot/test/codec.gd), in order, with what SnapshotDecoder makes
 * of each one received: the two decoders must agree on every one. The steps
 * cover what a decoder must get right and the bench never shows (Godot's
 * order, a seed handled after newer snapshots): a snapshot before the seed,
 * a keyframe, introductions after lost snapshots, an index given again, an
 * index a seed gives between ticks, a forgotten table, late seeds, positions
 * past 6553.5 px, lengths with a fraction, the late flag, acks past 2^31, an
 * id that is not ASCII, a snapshot without `t`.
 */

import type { PlayerSnap, WorldSnapshot } from "@project/shared";
import { SnapshotDecoder, SnapshotEncoder, bytesToBase64 } from "@project/shared";

export interface CodecStep {
  /** The packed item's `b`. */
  b: string;
  /** False: lost on the way, the decoder never sees it. */
  received: boolean;
  /** What SnapshotDecoder made of it (received steps). */
  expect?: WorldSnapshot;
  unnamed?: number;
  needsKeyframe?: boolean;
}

function player(id: string, n: number): PlayerSnap {
  return {
    id,
    x: Math.round(((n * 731.37) % 9000) * 10) / 10,
    y: Math.round((n * 97.3 + 5) * 10) / 10,
    dx: Math.round(Math.cos(n) * 1000) / 1000,
    dy: Math.round(Math.sin(n) * 1000) / 1000,
    // a float32 on the wire: the fraction must survive
    len: Math.fround(10 + n + ((n * 3) % 10) / 10 - 0.025),
    boost: n % 2 === 0,
    ack: 4_000_000_000 + n,
    // the late flag shares the flags byte with boost
    ...(n % 3 === 0 ? { late: true } : {}),
  };
}

function snapshot(tick: number, ids: string[], extra: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    tick,
    t: 1_761_000_000_123 + tick * 50,
    players: ids.map((id, i) => player(id, i + tick)),
    ...extra,
  };
}

export function codecFixtures(): CodecStep[] {
  const encoder = new SnapshotEncoder();
  const decoder = new SnapshotDecoder();
  const steps: CodecStep[] = [];
  const decode = (b: string): void => {
    const expect = decoder.decode(b);
    steps.push({
      b,
      received: true,
      expect,
      unnamed: decoder.unnamed,
      needsKeyframe: decoder.needsKeyframe,
    });
  };
  const tick = (s: WorldSnapshot, received = true): string => {
    const b = bytesToBase64(encoder.encode(s));
    if (received) decode(b);
    else steps.push({ b, received: false });
    return b;
  };
  const seed = (s: WorldSnapshot): string => bytesToBase64(encoder.encodeKeyframe(s));

  // A snapshot before the seed (Godot hands the seed over a frame late)
  tick(snapshot(1, ["ada", "bo"]), false);
  for (let t = 2; t <= 8; t++) tick(snapshot(t, ["ada", "bo"]), t === 8);
  decode(
    seed(
      snapshot(8, ["ada", "bo"], {
        food: [
          {
            tick: 8,
            spawned: [
              { id: "f1", x: 12.34, y: 7000.5, v: 1 },
              { id: "f2", x: 0, y: 9000, v: 2 },
            ],
          },
        ],
      }),
    ),
  );
  tick(
    snapshot(9, ["ada", "bo", "çé-ü"], {
      food: [
        { tick: 9, eaten: ["f1"] },
        { tick: 9, spawned: [{ id: "f4294967295", x: 1, y: 2, v: 1 }] },
      ],
    }),
  );
  // bo leaves and cy takes bo's index, both lost: the window introduces cy
  tick(snapshot(10, ["ada", "çé-ü"]), false);
  tick(snapshot(11, ["ada", "çé-ü", "cy"]), false);
  tick(snapshot(12, ["ada", "çé-ü", "cy"]));
  // çé-ü leaves; dee joins between ticks, and another subscriber's seed
  // gives dee çé-ü's index: the snapshots after it introduce dee
  tick(snapshot(13, ["ada", "cy"]));
  seed(snapshot(13, ["ada", "cy", "dee"]));
  for (let t = 14; t <= 18; t++) tick(snapshot(t, ["ada", "cy", "dee"]), false);
  tick(snapshot(19, ["ada", "cy", "dee"]));
  // eve joins between ticks, a seed gives her an index, and every snapshot
  // that introduces her is lost: the decoder forgets, and asks for a keyframe
  seed(snapshot(19, ["ada", "cy", "dee", "eve"]));
  for (let t = 20; t <= 25; t++) tick(snapshot(t, ["ada", "cy", "dee", "eve"]), false);
  tick(snapshot(26, ["ada", "cy", "dee", "eve"]));
  // a seed older than the window, handled after newer snapshots, names nobody
  const stale = seed(snapshot(26, ["ada", "cy", "dee", "eve"]));
  for (let t = 27; t <= 33; t++) tick(snapshot(t, ["ada", "cy", "dee", "eve"]), t === 33);
  decode(stale);
  tick(snapshot(34, ["ada", "cy", "dee", "eve"], { t: undefined }));
  // a fresh seed names them again; one within the window, handled after a
  // newer snapshot, names no index by its older owner
  decode(
    seed(
      snapshot(34, ["ada", "cy", "dee", "eve"], {
        t: undefined,
        food: [{ tick: 34, spawned: [] }],
      }),
    ),
  );
  const late = seed(snapshot(34, ["ada", "cy", "dee", "eve"]));
  tick(snapshot(35, ["ada", "cy", "eve"]));
  tick(snapshot(36, ["ada", "cy", "eve", "fay"]));
  decode(late);
  for (let t = 37; t <= 43; t++) tick(snapshot(t, ["ada", "cy", "eve", "fay"]), t === 43);
  return steps;
}
