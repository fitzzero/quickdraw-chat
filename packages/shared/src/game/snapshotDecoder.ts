/**
 * Unpacks the world stream's snapshots (snapshotCodec.ts has the layout),
 * learning the stream's id table: one decoder per client, kept across its
 * subscriptions to the stream and reset when the client follows another
 * server's world. Ported to GDScript as
 * apps/game/godot/scripts/snapshot_decoder.gd: keep the two in lockstep.
 */

import type { FoodDelta, FoodDTO, PlayerSnap, WorldSnapshot } from "../types/game.js";
import { GAME_FOOD_WINDOW } from "../types/game.js";
import { byteReader, type ByteReader } from "./bytes.js";
import {
  SNAPSHOT_CODEC_VERSION,
  SNAPSHOT_FLAG_KEYFRAME,
  SNAPSHOT_FLAG_T,
  SNAPSHOT_PLAYER_BOOST,
  SNAPSHOT_PLAYER_LATE,
  base64ToBytes,
} from "./snapshotCodec.js";

interface Name {
  id: string;
  /** The tick the index was given. */
  tick: number;
}

export class SnapshotDecoder {
  private readonly names = new Map<number, Name>();
  /** The newest snapshot tick decoded (-1: none yet). */
  private lastTick = -1;
  private keyframed = false;
  private unnamedCount = 0;

  /** Players the last decode left out: their index was never introduced to this decoder. */
  public get unnamed(): number {
    return this.unnamedCount;
  }

  /**
   * A keyframe named every player once, and the last decode still left one
   * out: the client asks for a keyframe (before the first one, it is on
   * its way).
   */
  public get needsKeyframe(): boolean {
    return this.keyframed && this.unnamedCount > 0;
  }

  /** Forgets the table (another server's world: its ticks start over). */
  public reset(): void {
    this.names.clear();
    this.lastTick = -1;
    this.keyframed = false;
    this.unnamedCount = 0;
  }

  /** Decodes a packed snapshot (the stream item's `b`, or its bytes). */
  public decode(packed: string | Uint8Array): WorldSnapshot {
    const input = byteReader(typeof packed === "string" ? base64ToBytes(packed) : packed);
    const version = input.u8();
    if (version !== SNAPSHOT_CODEC_VERSION) {
      throw new Error(`snapshotCodec: version ${version}, expected ${SNAPSHOT_CODEC_VERSION}`);
    }
    const flags = input.u8();
    const keyframe = (flags & SNAPSHOT_FLAG_KEYFRAME) !== 0;
    const snapshot: WorldSnapshot = { tick: input.u32(), players: [] };
    const unrepeated = input.u32() - 1;
    if ((flags & SNAPSHOT_FLAG_T) !== 0) snapshot.t = input.f64();

    // An index first introduced after the newest snapshot this decoder saw,
    // and no longer introduced: a name it holds may stand for another player
    if (this.lastTick >= 0 && unrepeated > this.lastTick) this.names.clear();
    // A seed older than the newest snapshot's window (Godot hands a seed
    // over after the items that came with it) may name an index by an owner
    // whose newer give no snapshot introduces any more: it names nobody
    this.readIntroductions(input, keyframe && snapshot.tick < this.lastTick - GAME_FOOD_WINDOW);
    this.unnamedCount = this.readPlayers(input, snapshot.players);
    const food = readFood(input, keyframe);
    if (food.length > 0) snapshot.food = food;

    if (keyframe) this.keyframed = true;
    this.lastTick = Math.max(this.lastTick, snapshot.tick);
    return snapshot;
  }

  /** Learns the snapshot's introductions (unless `skip`), the newest given winning. */
  private readIntroductions(input: ByteReader, skip: boolean): void {
    const count = input.u16();
    for (let i = 0; i < count; i++) {
      const index = input.u16();
      const tick = input.u32();
      const id = input.utf8(input.u8());
      if (skip) continue;
      const known = this.names.get(index);
      if (known === undefined || known.tick <= tick) this.names.set(index, { id, tick });
    }
  }

  /** Reads the players into `players`; answers how many it could not name. */
  private readPlayers(input: ByteReader, players: PlayerSnap[]): number {
    let unnamed = 0;
    const count = input.u16();
    for (let i = 0; i < count; i++) {
      const name = this.names.get(input.u16());
      const player = readPlayer(input, name?.id ?? "");
      if (name === undefined) unnamed++;
      else players.push(player);
    }
    return unnamed;
  }
}

function readPlayer(input: ByteReader, id: string): PlayerSnap {
  const x = input.u32() / 10;
  const y = input.u32() / 10;
  const dx = input.i16() / 1000;
  const dy = input.i16() / 1000;
  const len = input.f32();
  const flags = input.u8();
  const ack = input.u32();
  const boost = (flags & SNAPSHOT_PLAYER_BOOST) !== 0;
  // `late` only when set, as the sim's snapshot says it
  if ((flags & SNAPSHOT_PLAYER_LATE) === 0) return { id, x, y, dx, dy, len, boost, ack };
  return { id, x, y, dx, dy, len, boost, ack, late: true };
}

/** The food entries; a keyframe's one keeps `spawned` though it is empty. */
function readFood(input: ByteReader, keyframe: boolean): FoodDelta[] {
  const food: FoodDelta[] = [];
  const entries = input.u8();
  for (let i = 0; i < entries; i++) {
    const entry: FoodDelta = { tick: input.u32() };
    const spawned: FoodDTO[] = [];
    for (let count = input.u16(); spawned.length < count; ) {
      spawned.push({
        id: `f${input.u32()}`,
        x: input.u32() / 10,
        y: input.u32() / 10,
        v: input.u8(),
      });
    }
    if (spawned.length > 0 || keyframe) entry.spawned = spawned;
    const eaten: string[] = [];
    for (let count = input.u16(); eaten.length < count; ) eaten.push(`f${input.u32()}`);
    if (eaten.length > 0) entry.eaten = eaten;
    food.push(entry);
  }
  return food;
}
