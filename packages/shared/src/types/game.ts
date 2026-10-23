// ============================================================================
// Game Service — types shared by the API, the web wrapper, and (as the
// documented wire contract) the Godot client. The contract is
// contracts/game.ts; on quickdraw protocol v5 (docs/protocol-v5.md in
// @fitzzero/quickdraw-core) the game's traffic is:
//
//   commands       qd:call  gameService.joinGame | watchWorld | respawn | ...
//                  (watchWorld and joinGame put the CALLING socket in the
//                  world's room, GLOBAL_WORLD_ROOM)
//   client → server qd:ch   ["gameService", "input", GameInputs]
//                  (one per client tick, ~20Hz, fire-and-forget; dropped
//                  unless the sending socket is in the world's room)
//   server → client qd:stream ["gameService", "world", worldId,
//                  PackedWorldItem]
//                  (20Hz, volatile; each item a packed WorldSnapshot, see
//                  game/snapshotCodec.ts; the subscribe answers the current
//                  world)
//   server → room  qd:event ["gameService", "playerJoined" | "playerLeft" |
//                  "death" | "leaderboard", payload] (reliable)
// ============================================================================

/**
 * The single global world. A deterministic id (not a cuid) so the API, seed,
 * tests, and the Godot client can all reference it without a lookup, and so
 * the row can be recreated idempotently (e.g. after test-database resets).
 */
export const GLOBAL_WORLD_ID = "gameworld_global";
export const GLOBAL_WORLD_SLUG = "global";

/**
 * The global world's app room. watchWorld and joinGame put the calling socket
 * in it: its sockets hear the world's events, a player stays in the sim while
 * any socket of theirs is in it, and the input channel accepts only sockets
 * in it.
 */
export const GLOBAL_WORLD_ROOM = "world:gameworld_global";

/** Server simulation tick rate (Hz). Clients run prediction at the same rate. */
export const GAME_TICK_RATE = 20;

/** Frames one input message carries at most: its newest and the three before it. */
export const GAME_INPUT_FRAMES = 4;

/**
 * One input frame from a client. `seq` increments per frame, and the client
 * steps its prediction once per frame; the server steps the snake one frame
 * a tick, in seq order, and echoes the last seq its state holds in
 * PlayerSnap.ack, so the client drops acknowledged frames and replays the
 * rest (reconciliation). The server coasts a snake through a client's
 * stall, and the ack runs on: a client whose newest frame falls more than
 * GAME_INPUT_FRAMES behind the ack numbers its next frame after the ack, or
 * the server ignores its frames until they catch up.
 */
export interface GameInput {
  seq: number;
  /** Desired direction (normalized client-side; server re-normalizes). */
  dx: number;
  dy: number;
  boost: boolean;
}

/**
 * One message on the input channel: the newest frame last, with up to
 * GAME_INPUT_FRAMES - 1 unacknowledged ones before it, so the frames of a
 * lost or late message arrive with the next one. The server queues each
 * frame once by seq and steps one a tick, up to three while a backlog drains;
 * a tick with none queued coasts on the last intent, and `PlayerSnap.ack`
 * covers the coast.
 */
export interface GameInputs {
  frames: GameInput[];
}

/** Per-player state in a snapshot. Bodies are derived from head paths client-side. */
export interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Length in segments. */
  len: number;
  boost: boolean;
  /**
   * Seq of the last input frame the server's state holds for this player,
   * stepped or coasted for (reconciliation anchor). It runs ahead of a
   * client that stalled.
   */
  ack: number;
}

export interface FoodDTO {
  id: string;
  x: number;
  y: number;
  /** Segments gained when eaten. */
  v: number;
}

/** Ticks of food changes every snapshot repeats, so a dropped one costs nothing. */
export const GAME_FOOD_WINDOW = 6;

/** The food one tick changed. */
export interface FoodDelta {
  tick: number;
  spawned?: FoodDTO[];
  eaten?: string[];
}

/**
 * Pushed to the world stream every tick (volatile). Players are full; food
 * is delta-encoded, and each snapshot repeats the changes of the
 * GAME_FOOD_WINDOW ticks up to its own (`food`, the ticks that changed food,
 * oldest first), so a client that missed a snapshot applies them with the
 * next. A client applies each tick's change once, in tick order. One that
 * missed more than the window subscribes to the stream again: its seed is a
 * keyframe of the current world (every snake, and all the food in one entry
 * at its own tick, with no `t`), which replaces the food the client holds.
 * A client takes only a keyframe's food: it may be handled after newer
 * snapshots.
 * The watchWorld/joinGame bootstrap holds the same world too.
 */
export interface WorldSnapshot {
  tick: number;
  /**
   * Server send time (epoch ms, stamped by the loop at emit — the sim stays
   * pure). Lets clients estimate clock offset + one-way delay instead of
   * inferring the timeline from arrival cadence. Optional/additive so older
   * clients ignore it.
   */
  t?: number;
  players: PlayerSnap[];
  food?: FoodDelta[];
}

/**
 * The world stream's item: a WorldSnapshot packed into bytes, base64
 * (`b`). Decode it with a SnapshotDecoder (game/snapshotCodec.ts; the Godot
 * client's port is snapshot_decoder.gd), one per subscription: the players
 * are named by the stream's id table, which each snapshot and keyframe
 * introduces.
 */
export interface PackedWorldItem {
  b: string;
}

export interface GamePlayerMeta {
  id: string;
  name: string | null;
  /** 0-360, assigned at join; drives snake color on every client. */
  hue: number;
}

export interface GameDeathEvent {
  id: string;
  /** Final length, for kill-feed style UI. */
  len: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string | null;
  len: number;
}

/**
 * Spectate bootstrap: full world state without spawning. Godot boots into
 * this on the web; joinGame (called by the wrapper's pre-game dialog) is
 * what actually spawns the player.
 */
export interface WorldBootstrap {
  worldId: string;
  /** The world's global chat (null until bootstrapped). */
  chatId: string | null;
  tick: number;
  tickRate: number;
  bounds: { w: number; h: number };
  players: GamePlayerMeta[];
  snaps: PlayerSnap[];
  food: FoodDTO[];
}

export interface GameBootstrap extends WorldBootstrap {
  you: GamePlayerMeta;
}

/** NPC ids are namespaced; clients use this for 🤖 markers etc. */
export const NPC_ID_PREFIX = "npc-";

export interface HighScoreEntry {
  userId: string;
  name: string | null;
  image: string | null;
  isGuest: boolean;
  bestLength: number;
}

/**
 * The contract between the web wrapper and the Godot build. The page sets
 * `window.QuickdrawHost` to this shape BEFORE starting the engine; Godot
 * reads it via JavaScriptBridge (see apps/game/godot/scripts/autoload/net.gd).
 */
export interface QuickdrawHostConfig {
  /** API origin, e.g. "http://localhost:4000". */
  apiUrl: string;
  /** Socket.io path override (Discord Activities: "/.proxy/api/socket.io"). */
  socketPath?: string;
  /** JWT for token auth; null/absent = cookie auth rides the WS handshake. */
  authToken?: string | null;
  /** World to join (slug). */
  worldSlug: string;
}
