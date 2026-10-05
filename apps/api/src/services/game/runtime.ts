/**
 * The running game: the simulation, its loop and who plays (`sim`, `loop`,
 * `playingUsers`), which a service object cannot hold, as one module-level
 * runtime that the service's handlers, its input channel, its room-leave
 * hook and each server root (the API, the tests, the netcode bench) share.
 *
 * The loop's output reaches clients through quickdraw's realtime kit, from
 * code that is not a handler: each tick's snapshot goes to the world stream
 * (`qd.stream`, volatile; a subscriber starts from the current world, which
 * the service computes), deaths, the leaderboard and departures to the
 * world's room (`qd.rooms.emit`). Anyone in the world's room keeps the world
 * running (`qd.rooms.size`).
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
   * Is anyone watching? By default: any socket in the world's room on this
   * process (`qd.rooms.size`), players and spectators, signed in or not, so
   * spectators keep the NPC world running behind the pre-game dialog.
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
 * Whether any socket on this process is in the world's room. The loop asks
 * it every tick: `rooms.size` answers at once, and counts this node's
 * sockets only (the game runs on one process, see game-patterns.md).
 */
function worldHasAudience(): boolean {
  return qd.rooms.size(GLOBAL_WORLD_ROOM) > 0;
}

/**
 * Score writes happen off the tick path, in a unit of work of their own;
 * failures are logged, never thrown. The writes go through the tracked
 * client to GameScore, which gameService lists in `writes`: they change its
 * service topic, which the score queries watch, so their readers read them
 * again.
 */
function persistScore(db: Db, death: GameDeathEvent): void {
  // Bots have no User row and no high scores
  if (isNpcId(death.id)) return;
  void qd
    .run(
      async () => {
        await db.gameScore.upsert({
          where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: death.id } },
          update: {},
          create: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: death.len },
          select: { bestLength: true },
        });
        await db.gameScore.updateMany({
          where: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: { lt: death.len } },
          data: { bestLength: death.len },
        });
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
    hasAudience: options.hasAudience ?? worldHasAudience,
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
 * The game service's room-leave hook: a player stays in the sim while any
 * socket of theirs is in the world's room (the web page and the Godot client
 * are two sockets of one user), and leaves it when the last one leaves or
 * disconnects. Every server the service runs in calls it.
 */
export const onGameRoomLeave: RoomLeaveHandler = ({ principal, rooms }) => {
  const runtime = current;
  if (principal === null || runtime === undefined) return;
  if (rooms.some(({ room, last }) => room === GLOBAL_WORLD_ROOM && last)) {
    removePlayer(runtime, principal.userId);
  }
};
