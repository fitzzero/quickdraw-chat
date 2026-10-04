/**
 * The running game: the simulation, its loop and who plays — 4.x's
 * GameService fields (`sim`, `loop`, `playingUsers`), which a 5.0 service
 * object cannot hold, as one module-level runtime that the service's
 * handlers, its input channel and each server root (the API, the tests, the
 * netcode bench) share.
 *
 * The loop's output reaches clients through quickdraw's realtime kit, from
 * code that is not a handler: each tick's snapshot goes to the world stream
 * (`qd.stream`, volatile, seeded), deaths, the leaderboard and departures to
 * the world's room (`qd.rooms.emit`). A server root passes `onGameRoomLeave`
 * to `createServer` (a player whose last socket left the world leaves the
 * sim) and `worldAudience(server)` to the runtime (anyone in the world's room
 * keeps it running).
 */

import type { GameDeathEvent } from "@project/shared";
import { GLOBAL_WORLD_ID, GLOBAL_WORLD_ROOM, gameContract } from "@project/shared";
import type { RoomLeaveHandler } from "@fitzzero/quickdraw-core/server";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import { logger } from "../../utils/logger.js";
import { GameLoop, type GameLoopDeps, type GameLoopEmits } from "./loop.js";
import { GameWorldSim, isNpcId, type GameTunables } from "./world.js";

type Db = typeof appDb;

export interface GameRuntimeOptions {
  simSeed?: number;
  tunables?: Partial<GameTunables>;
  /**
   * Is anyone in the world's room (`worldAudience(server)`)? Spectators keep
   * the NPC world running behind the pre-game dialog. Without it only playing
   * humans do.
   */
  hasAudience?: () => boolean;
  /** Bench/observability hook — see GameLoopDeps.onTick. */
  onTick?: GameLoopDeps["onTick"];
}

export interface GameRuntime {
  readonly sim: GameWorldSim;
  readonly loop: GameLoop;
  /** Users who joined the game (spawned). */
  readonly playingUsers: Set<string>;
}

/** The world stream, through whichever server was created last. */
const worldStream = qd.stream(gameContract, "world");

/** The loop's output, on the wire: the world stream and the world's room. */
const wire: GameLoopEmits = {
  // quickdraw-5.0 finding: push checks every item against the schema at the tick rate; measured cheap here (9 µs of a 32 µs push to 8 sockets beside a 243 µs sim step, 24 snakes; event-loop delay p99 1.7 ms at 20 Hz), but a large world has no way to skip it outside development
  snapshot: (snapshot) => {
    worldStream.push(GLOBAL_WORLD_ID, snapshot);
  },
  death: (death) => {
    qd.rooms.emit(GLOBAL_WORLD_ROOM, gameContract, "death", death);
  },
  leaderboard: (entries) => {
    qd.rooms.emit(GLOBAL_WORLD_ROOM, gameContract, "leaderboard", entries);
  },
};

/**
 * Score writes happen off the tick path, in a unit of work of their own;
 * failures are logged, never thrown. When the player's stored best changed
 * (a first score, or a longer run), the world hears `scoreSaved`, after the
 * write, so a client that reads the scores again sees it.
 */
function persistScore(db: Db, death: GameDeathEvent): void {
  // Bots have no User row and no high scores
  if (isNpcId(death.id)) return;
  const where = { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: death.id } };
  void qd
    .run(
      async () => {
        const stored = await db.gameScore.upsert({
          where,
          update: {},
          create: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: death.len },
          select: { bestLength: true },
        });
        const { count } = await db.gameScore.updateMany({
          where: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: { lt: death.len } },
          data: { bestLength: death.len },
        });
        if (count > 0 || stored.bestLength === death.len) {
          qd.rooms.emit(GLOBAL_WORLD_ROOM, gameContract, "scoreSaved", {
            userId: death.id,
            bestLength: death.len,
          });
        }
      },
      { detached: true },
    )
    .catch((error: unknown) => {
      logger.warn("Failed to persist game score", {
        userId: death.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

let current: GameRuntime | undefined;

/**
 * Builds the game's runtime against `db` and makes it the one the game
 * service uses (the last one built wins): the server builds it at start-up
 * with the stored tunables, the tests and the bench with their own seed. The
 * loop is never started here.
 */
export function createGameRuntime(db: Db, options: GameRuntimeOptions = {}): GameRuntime {
  const sim = new GameWorldSim({ seed: options.simSeed, tunables: options.tunables });
  const playingUsers = new Set<string>();
  const loop = new GameLoop({
    sim,
    emit: wire,
    onDeath: (death) => persistScore(db, death),
    hasAudience: options.hasAudience ?? (() => false),
    ...(options.onTick ? { onTick: options.onTick } : {}),
  });
  current = { sim, loop, playingUsers };
  return current;
}

/** The game's runtime: the one built last, or a default one over the app's db. */
export function gameRuntime(db: Db): GameRuntime {
  current ??= createGameRuntime(db);
  return current;
}

/** The runtime built last, if any (the input channel has no `db` to build one with). */
export function activeGameRuntime(): GameRuntime | undefined {
  return current;
}

/** Takes a player out of the sim; the world hears `playerLeft` when they were in it. */
export function removePlayer(runtime: GameRuntime, userId: string): void {
  runtime.playingUsers.delete(userId);
  if (runtime.sim.removePlayer(userId)) {
    qd.rooms.emit(GLOBAL_WORLD_ROOM, gameContract, "playerLeft", { id: userId });
  }
}

/**
 * `createServer`'s `onRoomLeave` for the game: a player stays in the sim
 * while any socket of theirs is in the world's room (the web page and the
 * Godot client are two sockets of one user), and leaves it when the last one
 * leaves or disconnects. 4.x did this in GameService's unsubscribeSocket and
 * unsubscribe overrides.
 */
// quickdraw-5.0 finding: onRoomLeave is one createServer option for the whole app, not part of the service that owns the room, so every server root (the API, the test app, the netcode bench) must pass the game's handler by hand, and a root that forgets it leaks players silently
export const onGameRoomLeave: RoomLeaveHandler = ({ principal, rooms }) => {
  const runtime = current;
  if (principal === null || runtime === undefined) return;
  if (rooms.some(({ room, last }) => room === GLOBAL_WORLD_ROOM && last)) {
    removePlayer(runtime, principal.userId);
  }
};

/** The part of a quickdraw server `worldAudience` reads: its Socket.IO rooms on this process. */
export interface SocketRooms {
  readonly io: {
    readonly sockets: {
      readonly adapter: { readonly rooms: ReadonlyMap<string, ReadonlySet<string>> };
    };
  };
}

/**
 * Whether any socket on this process is in the world's room: players and
 * spectators, signed in or not. The loop asks it every tick, so it must be
 * synchronous; the game runs on one process (see game-patterns.md).
 */
// quickdraw-5.0 finding: presence answers only by promise (count and users may ask every node) and leaves anonymous sockets out, so a tick loop asking "is anyone in this room" 20 times a second has no API: this reads Socket.IO's adapter under the framework
export function worldAudience(server: SocketRooms): () => boolean {
  return () => (server.io.sockets.adapter.rooms.get(GLOBAL_WORLD_ROOM)?.size ?? 0) > 0;
}
