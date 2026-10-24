/**
 * Packs the world stream's snapshots (snapshotCodec.ts has the layout),
 * holding the stream's id table: one encoder per stream scope (a world),
 * shared by the loop's snapshots and the subscribers' seeds.
 */

import type { FoodDelta, PlayerSnap, WorldSnapshot } from "../types/game.js";
import { GAME_FOOD_WINDOW } from "../types/game.js";
import { byteWriter, type ByteWriter } from "./bytes.js";
import {
  SNAPSHOT_CODEC_VERSION,
  SNAPSHOT_FLAG_KEYFRAME,
  SNAPSHOT_FLAG_T,
} from "./snapshotCodec.js";

const FOOD_ID = /^f(\d+)$/;
const utf8 = new TextEncoder();

interface Given {
  id: string;
  /** The tick the index was given: the newest give of an index wins in a decoder. */
  tick: number;
  /**
   * The first tick whose snapshot introduces it: the give's own, or for a
   * seed's (between ticks, after that tick's snapshot went out) the next.
   */
  first: number;
}

export class SnapshotEncoder {
  private readonly byId = new Map<string, number>();
  private readonly given: (Given | undefined)[] = [];
  private readonly free: number[] = [];
  /** The first ticks of the gives snapshots still introduce, oldest first. */
  private readonly recent: number[] = [];
  /** The newest first tick of a give snapshots no longer introduce (-1: none). */
  private unrepeated = -1;

  /**
   * A tick's snapshot: frees the indexes of players left out of it, gives
   * one to each player new to it, and introduces those given in the last
   * GAME_FOOD_WINDOW ticks.
   */
  public encode(snapshot: WorldSnapshot): Uint8Array {
    const present = new Set(snapshot.players.map((p) => p.id));
    for (const [id, index] of this.byId) {
      if (present.has(id)) continue;
      this.byId.delete(id);
      this.given[index] = undefined;
      this.free.push(index);
    }
    this.free.sort((a, b) => a - b);
    this.giveIndexes(snapshot, snapshot.tick);
    const since = snapshot.tick - GAME_FOOD_WINDOW;
    while ((this.recent[0] ?? Infinity) <= since) {
      this.unrepeated = Math.max(this.unrepeated, this.recent.shift() ?? -1);
    }
    return this.pack(snapshot, false, (given) => given.first > since);
  }

  /**
   * A subscriber's seed, computed between ticks: introduces every index in
   * use and frees none (so no index is given twice at one tick). An index
   * it gives is introduced from the next tick's snapshot on.
   */
  public encodeKeyframe(snapshot: WorldSnapshot): Uint8Array {
    this.giveIndexes(snapshot, snapshot.tick + 1);
    return this.pack(snapshot, true, () => true);
  }

  private giveIndexes(snapshot: WorldSnapshot, first: number): void {
    for (const player of snapshot.players) {
      if (this.byId.has(player.id)) continue;
      const index = this.free.shift() ?? this.given.length;
      if (index > 0xffff) throw new RangeError("snapshotCodec: more than 65536 players");
      this.byId.set(player.id, index);
      this.given[index] = { id: player.id, tick: snapshot.tick, first };
      this.recent.push(first);
    }
  }

  private pack(
    snapshot: WorldSnapshot,
    keyframe: boolean,
    introduce: (given: Given) => boolean,
  ): Uint8Array {
    const out = byteWriter();
    out.u8(SNAPSHOT_CODEC_VERSION);
    out.u8(
      (snapshot.t === undefined ? 0 : SNAPSHOT_FLAG_T) | (keyframe ? SNAPSHOT_FLAG_KEYFRAME : 0),
    );
    out.u32(snapshot.tick);
    out.u32(keyframe ? 0 : this.unrepeated + 1);
    if (snapshot.t !== undefined) out.f64(snapshot.t);
    this.writeIntroductions(out, introduce);
    out.u16(snapshot.players.length);
    for (const player of snapshot.players) writePlayer(out, this.byId.get(player.id) ?? 0, player);
    writeFood(out, snapshot.food ?? []);
    return out.done();
  }

  private writeIntroductions(out: ByteWriter, introduce: (given: Given) => boolean): void {
    const intros: { index: number; given: Given }[] = [];
    this.given.forEach((given, index) => {
      if (given !== undefined && introduce(given)) intros.push({ index, given });
    });
    out.u16(intros.length);
    for (const { index, given } of intros) {
      const id = utf8.encode(given.id);
      if (id.length > 0xff) throw new RangeError("snapshotCodec: a player id over 255 bytes");
      out.u16(index);
      out.u32(given.tick);
      out.u8(id.length);
      out.raw(id);
    }
  }
}

function writePlayer(out: ByteWriter, index: number, player: PlayerSnap): void {
  out.u16(index);
  out.u32(tenths(player.x));
  out.u32(tenths(player.y));
  out.i16(clamp(Math.round(player.dx * 1000), -0x8000, 0x7fff));
  out.i16(clamp(Math.round(player.dy * 1000), -0x8000, 0x7fff));
  out.u16(clamp(player.len, 0, 0xffff));
  out.u8(player.boost ? 1 : 0);
  out.u32(player.ack);
}

function writeFood(out: ByteWriter, food: FoodDelta[]): void {
  out.u8(food.length);
  for (const entry of food) {
    out.u32(entry.tick);
    out.u16(entry.spawned?.length ?? 0);
    for (const item of entry.spawned ?? []) {
      out.u32(foodNumber(item.id));
      out.u32(tenths(item.x));
      out.u32(tenths(item.y));
      out.u8(item.v);
    }
    out.u16(entry.eaten?.length ?? 0);
    for (const id of entry.eaten ?? []) out.u32(foodNumber(id));
  }
}

function tenths(px: number): number {
  return clamp(Math.round(px * 10), 0, 0xffffffff);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function foodNumber(id: string): number {
  const match = FOOD_ID.exec(id);
  if (!match) throw new RangeError(`snapshotCodec: food id "${id}" is not f<n>`);
  return Number(match[1]);
}
