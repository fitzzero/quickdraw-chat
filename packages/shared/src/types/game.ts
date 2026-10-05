// ============================================================================
// Game Service — types shared by the API, the web wrapper, and (as the
// documented wire contract) the Godot client. The contract is
// contracts/game.ts; on quickdraw protocol v5 (docs/protocol-v5.md in
// @fitzzero/quickdraw-core) the game's traffic is:
//
//   commands       qd:call  gameService.joinGame | watchWorld | respawn | ...
//                  (watchWorld and joinGame put the CALLING socket in the
//                  world's room, GLOBAL_WORLD_ROOM)
//   client → server qd:ch   ["gameService", "input", GameInput]
//                  (~20Hz, fire-and-forget; dropped unless the sending
//                  socket is in the world's room)
//   server → client qd:stream ["gameService", "world", worldId,
//                  WorldSnapshot]
//                  (20Hz, volatile, seeded with the latest snapshot)
//   server → room  qd:event ["gameService", "playerJoined" | "playerLeft" |
//                  "death" | "leaderboard" | "scoreSaved", payload] (reliable)
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

/**
 * One input frame from a client. `seq` increments per frame; the server
 * echoes the last applied seq back in PlayerSnap.ack so the client can
 * drop acknowledged inputs and replay the rest (reconciliation).
 */
export interface GameInput {
  seq: number;
  /** Desired direction (normalized client-side; server re-normalizes). */
  dx: number;
  dy: number;
  boost: boolean;
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
  /** Last input seq the server applied for this player (reconciliation anchor). */
  ack: number;
}

export interface FoodDTO {
  id: string;
  x: number;
  y: number;
  /** Segments gained when eaten. */
  v: number;
}

/**
 * Pushed to the world stream every tick (volatile). Food is delta-encoded;
 * players are full, so the stream's seed (the latest snapshot) places every
 * snake at once, and the full food comes from the watchWorld/joinGame
 * bootstrap.
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
  foodSpawned?: FoodDTO[];
  foodEaten?: string[];
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

/** A player's stored best changed (their first score, or a longer run): high scores are stale. */
export interface ScoreSavedEvent {
  userId: string;
  bestLength: number;
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
