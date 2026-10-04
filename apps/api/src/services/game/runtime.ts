/**
 * The running game: the simulation, its loop and who plays — 4.x's
 * GameService fields (`sim`, `loop`, `playingUsers`), which a 5.0 service
 * object cannot hold, as one module-level runtime the service's handlers and
 * the server's start-up share.
 *
 * quickdraw-game: this is the minimal port that keeps the game compiling on
 * 5.0 until its own port (the realtime kit and the Godot client on protocol
 * v5). Until then the loop's broadcasts go nowhere (`broadcast` below), and a
 * player leaves the sim only through leaveGame.
 */

import type { GameDeathEvent } from "@project/shared";
import { GLOBAL_WORLD_ID } from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import { logger } from "../../utils/logger.js";
import { GameLoop, type GameLoopDeps } from "./loop.js";
import { GameWorldSim, isNpcId, type GameTunables } from "./world.js";

type Db = typeof appDb;

export interface GameRuntimeOptions {
  simSeed?: number;
  tunables?: Partial<GameTunables>;
  /** Bench/observability hook — see GameLoopDeps.onTick. */
  onTick?: GameLoopDeps["onTick"];
}

export interface GameRuntime {
  readonly sim: GameWorldSim;
  readonly loop: GameLoop;
  /** Users who joined the game (spawned). */
  readonly playingUsers: Set<string>;
}

/**
 * A room broadcast of the 4.x world events (`game:snapshot`, `game:death`,
 * `game:playerJoined`, ...). It sends nothing until the game's port: 5.0
 * sends typed events with `ctx.rooms.emit` from a method, and streams with
 * `qd.stream(...).push` from anywhere, neither of which the contract
 * declares yet.
 */
// quickdraw-migrate: review [emit] room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
export function broadcast(_event: string, _payload: unknown): void {
  // quickdraw-game: inert until the game's 5.0 port (child 4)
}

/** Score writes happen off the tick path; failures are logged, never thrown. */
function persistScore(db: Db, death: GameDeathEvent): void {
  // Bots have no User row and no high scores
  if (isNpcId(death.id)) return;
  void qd
    .run(async () => {
      await db.gameScore.upsert({
        where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: death.id } },
        update: {},
        create: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: death.len },
      });
      await db.gameScore.updateMany({
        where: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: { lt: death.len } },
        data: { bestLength: death.len },
      });
    })
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
    emitVolatile: broadcast,
    emitReliable: broadcast,
    onDeath: (death) => persistScore(db, death),
    // 4.x kept the NPC world alive for the world room's spectators too; who
    // watches is the room's presence after the port
    hasAudience: () => playingUsers.size > 0,
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
