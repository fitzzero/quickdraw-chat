/**
 * The world stream's packed snapshot (HYPOTHESES.md #7): a WorldSnapshot as
 * bytes, carried base64 in the stream item (`PackedWorldItem`, `{ b }`), a
 * fraction of its JSON. The Godot client reads Engine.IO text frames only,
 * so the bytes travel as a JSON string; a binary attachment would save the
 * base64's third (a follow-up). A head travels exactly as the sim rounds it
 * (tenths of a pixel, thousandths of a direction), so a decoded snapshot
 * holds the players that were encoded; food positions travel in tenths of a
 * pixel, 0.05 px at most from the server's.
 *
 * A player is named by an index into the stream's id table, not by its id.
 * The encoder gives a player an index when it first appears in a snapshot
 * and frees it when it is left out of one (a death or a departure); each
 * snapshot introduces the indexes given in its last GAME_FOOD_WINDOW ticks
 * (the id and the tick given), as it repeats the food changes, and a
 * keyframe (the stream's seed) introduces every index in use. A decoder
 * learns the introductions first, the newest given winning (a keyframe may
 * be handled after newer snapshots). Each snapshot also names the newest
 * tick an index was given at that it no longer introduces: a decoder whose
 * newest snapshot is older missed that introduction (a gap longer than the
 * window, which asks for a keyframe by the food's rule too). It forgets its
 * table, and leaves out each player it cannot name (`unnamed`) until a
 * keyframe names them all again.
 *
 * SnapshotEncoder (snapshotEncoder.ts) packs, SnapshotDecoder
 * (snapshotDecoder.ts) unpacks; apps/game/godot/scripts/snapshot_decoder.gd
 * is the decoder's port: keep the two in lockstep. Layout, little-endian:
 *
 *   u8   SNAPSHOT_CODEC_VERSION
 *   u8   flags: SNAPSHOT_FLAG_T (has `t`), SNAPSHOT_FLAG_KEYFRAME
 *   u32  tick
 *   u32  the newest tick an index was given at that the snapshot no longer
 *        introduces, + 1 (0: none)
 *   f64  t                                       (SNAPSHOT_FLAG_T)
 *   u16  introductions, each: u16 index, u32 tick given, u8 length, UTF-8 id
 *   u16  players, each: u16 index, u32 x, u32 y (tenths of a px),
 *        i16 dx, i16 dy (thousandths), u16 len, u8 flags (1: boost), u32 ack
 *   u8   food entries, each: u32 tick,
 *        u16 spawned, each: u32 id (the n of `f<n>`), u32 x, u32 y (tenths), u8 v
 *        u16 eaten, each: u32 id
 *
 * Positions are u32: an admin may size the world as they like (the
 * tunables apply live), and u16 tenths would end at 6553.5 px.
 */

/** The layout's version: its first byte. */
export const SNAPSHOT_CODEC_VERSION = 1;
/** The snapshot carries `t`. */
export const SNAPSHOT_FLAG_T = 1;
/** A keyframe: its introductions are the whole id table. */
export const SNAPSHOT_FLAG_KEYFRAME = 2;
/** The bytes of one player in a snapshot. */
export const SNAPSHOT_PLAYER_BYTES = 21;
/** The bytes of one piece of food a food entry spawns. */
export const SNAPSHOT_SPAWNED_BYTES = 13;

/** Base64 of bytes (the stream item's `b`). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The bytes a base64 string holds. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
