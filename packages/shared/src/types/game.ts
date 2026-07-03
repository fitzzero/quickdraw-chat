// ============================================================================
// Game Service — types shared by the API, the web wrapper, and (as the
// documented wire contract) the Godot client.
//
// Commands (join/respawn/leave) are ordinary quickdraw methods. The two
// high-frequency streams use quickdraw channels + volatile room events:
//   client → server  channel "gameService:input"        (~20Hz, fire-and-forget)
//   server → room    event   "game:snapshot"            (20Hz, volatile)
//   server → room    events  "game:playerJoined" | "game:playerLeft" |
//                            "game:death" | "game:leaderboard"   (reliable)
// ============================================================================

/**
 * The single global world. A deterministic id (not a cuid) so the API, seed,
 * tests, and the Godot client can all reference it without a lookup, and so
 * the row can be recreated idempotently (e.g. after test-database resets).
 */
export const GLOBAL_WORLD_ID = "gameworld_global";
export const GLOBAL_WORLD_SLUG = "global";

/** Server simulation tick rate (Hz). Clients run prediction at the same rate. */
export const GAME_TICK_RATE = 20;

/** Room event names broadcast to the world's service room. */
export const GAME_EVENTS = {
  /** WorldSnapshot — volatile, every tick. */
  snapshot: "game:snapshot",
  /** GamePlayerMeta — reliable, when a player joins. */
  playerJoined: "game:playerJoined",
  /** { id: string } — reliable, when a player leaves. */
  playerLeft: "game:playerLeft",
  /** GameDeathEvent — reliable, when a snake dies. */
  death: "game:death",
  /** LeaderboardEntry[] — reliable, 1Hz. */
  leaderboard: "game:leaderboard",
} as const;

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

/** Broadcast every tick (volatile). Food is delta-encoded; players are full. */
export interface WorldSnapshot {
  tick: number;
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

export interface GameBootstrap {
  worldId: string;
  /** The world's global chat (null until bootstrapped). */
  chatId: string | null;
  tick: number;
  tickRate: number;
  bounds: { w: number; h: number };
  you: GamePlayerMeta;
  players: GamePlayerMeta[];
  snaps: PlayerSnap[];
  food: FoodDTO[];
}

export interface GameServiceMethods {
  joinGame: {
    payload: { worldId: string };
    response: GameBootstrap;
  };
  respawn: {
    payload: { worldId: string };
    response: { ok: true };
  };
  leaveGame: {
    payload: { worldId: string };
    response: { ok: true };
  };
  getWorld: {
    payload: { slug: string };
    response: { id: string; name: string; chatId: string | null } | null;
  };
}

/** Channel payloads (see ServiceChannelMap in quickdraw-core). */
export interface GameServiceChannels {
  input: GameInput;
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
