import type {
  AccessLevel,
  GameBootstrap,
  GameDeathEvent,
  HighScoreEntry,
  WorldBootstrap,
} from "@project/shared";
import {
  GAME_EVENTS,
  GLOBAL_WORLD_ID,
  GAME_TICK_RATE,
  serviceRoom,
  gameContract,
} from "@project/shared";
// quickdraw-migrate: review [v4-api] 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
import { type QuickdrawSocket, resolver } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";
import { isNpcId } from "./world.js";
import { qd } from "../../quickdraw.js";
import { db } from "../../db.js";

// Zod schemas for validation
const gameInputSchema = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dx: z.number().finite(),
  dy: z.number().finite(),
  boost: z.boolean(),
});

// Admin schema - defines fields available for admin CRUD
const adminGameWorldSchema = z.object({
  slug: z.string(),
  name: z.string(),
  chatId: z.string().nullable(),
});

// quickdraw-migrate: review [this] 4.x constructor code of GameService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
// quickdraw-5.0 finding: the codemod dropped GameService's fields with their initializers: sim (new GameWorldSim({ seed, tunables })), loop (new GameLoop({ sim, emitVolatile, emitReliable, onDeath, hasAudience, onTick })) and playingUsers (new Set()), the constructor's options type and the GameWorldSim/GameLoop imports; only their uses are marked, so the loop's wiring survives only in the 4.x file (before "chore: run quickdraw-codemod v5")
function setUpGameService(): void {
  const room = serviceRoom("gameService", GLOBAL_WORLD_ID);
  initChannels();
  installAdmin();
}

export function startLoop(): void {
  // quickdraw-migrate: review [this] this.loop was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  this.loop.start();
}

export function stopLoop(): void {
  // quickdraw-migrate: review [this] this.loop was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  this.loop.stop();
}

// Worlds are public-read for any authenticated user: subscription gives
// room membership (snapshots + chat events), which in turn gates the
// input channel. Writes still require service-level access.
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
function checkAccess(
  _userId: string,
  _entryId: string,
  requiredLevel: AccessLevel,
  _socket: unknown,
): boolean {
  return requiredLevel === "Read";
}

// Remove the player only when NO subscribed socket of theirs remains in
// the world room. Covers both leave paths: disconnect (unsubscribeSocket)
// and explicit unsubscribe. The base class removes the departing socket
// from `subscribers` before these hooks run, so a plain scan suffices.
// quickdraw-migrate: review [this] 4.x overrode unsubscribeSocket(socket) (a disconnect) and unsubscribe(entryId, socket) (leaving the world's row) to call maybeRemovePlayer(socket.userId) after the base class removed the socket: run it wherever a player's last socket leaves the world
// quickdraw-5.0 finding: the codemod kept those two overrides as module functions calling super.unsubscribeSocket(socket) and super.unsubscribe(entryId, socket), which does not parse (oxlint stops at the syntax error, and no baseline can hold one); they are removed, and the marker above keeps their item
function maybeRemovePlayer(userId: string | undefined): void {
  // quickdraw-migrate: review [this] this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  if (!userId || !this.playingUsers.has(userId)) return;
  // quickdraw-migrate: review [this] this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  const roomSockets = this.subscribers.get(GLOBAL_WORLD_ID);
  if (roomSockets) {
    for (const socket of roomSockets) {
      // Another socket anchors them
      if (socket.userId === userId) return;
    }
  }
  // quickdraw-migrate: review [this] this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  this.playingUsers.delete(userId);
  // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  if (this.sim.removePlayer(userId)) {
    // quickdraw-migrate: review [emit] room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
    this.emitToRoom(serviceRoom("gameService", GLOBAL_WORLD_ID), GAME_EVENTS.playerLeft, {
      id: userId,
    });
  }
}

/** Score writes happen off the tick path; failures are logged, never thrown. */
function persistScore(death: GameDeathEvent): void {
  // Bots have no User row and no high scores
  if (isNpcId(death.id)) return;
  void (async () => {
    await db.gameScore.upsert({
      where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: death.id } },
      update: {},
      create: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: death.len },
    });
    await db.gameScore.updateMany({
      where: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: { lt: death.len } },
      data: { bestLength: death.len },
    });
  })().catch((error: unknown) => {
    // quickdraw-migrate: review [this] the 4.x service logger: take a Logger argument, or log from the handler that calls this with ctx.log
    this.logger.warn("Failed to persist game score", {
      userId: death.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * World-room membership for an anonymous socket: receives the volatile
 * snapshot + reliable event streams and counts toward `hasAudience` (the
 * NPC world keeps ticking for spectators). Registered in `subscribers` so
 * the standard disconnect cleanup (`unsubscribeSocket`) applies.
 */
function joinSpectator(socketId: string): void {
  // quickdraw-migrate: review [this] this.io was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  const socket = this.io?.sockets.sockets.get(socketId) as QuickdrawSocket | undefined;
  if (!socket) return;
  void socket.join(serviceRoom("gameService", GLOBAL_WORLD_ID));
  // quickdraw-migrate: review [this] this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  let roomSockets = this.subscribers.get(GLOBAL_WORLD_ID);
  if (!roomSockets) {
    roomSockets = new Set();
    // quickdraw-migrate: review [this] this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
    this.subscribers.set(GLOBAL_WORLD_ID, roomSockets);
  }
  roomSockets.add(socket);
}

/** Idempotent membership in the world chat (the in-game chat overlay). */
async function ensureChatMembership(
  chatId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!chatId) return;
  await db.chatMember.upsert({
    where: { chatId_userId: { chatId, userId } },
    update: {},
    create: { chatId, userId, level: "Read" },
  });
}

function buildWorldBootstrap(chatId: string | null): WorldBootstrap {
  // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  const state = this.sim.getBootstrapState();
  return {
    worldId: GLOBAL_WORLD_ID,
    chatId,
    // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
    tick: this.sim.tick,
    tickRate: GAME_TICK_RATE,
    bounds: {
      // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
      w: this.sim.tunables.worldWidth, // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
      h: this.sim.tunables.worldHeight,
    },
    players: state.players,
    snaps: state.snaps,
    food: state.food,
  };
}

function initChannels(): void {
  // Client input at ~tick rate. Fire-and-forget: invalid/unauthorized/
  // excess frames are dropped silently; the token bucket replaces the
  // global rate limiter for this event.
  // quickdraw-migrate: review [channel] 4.x channel: declare it in the contract's channels ({ payload, ratePerSecond, burst, requires }; requireRoom becomes requires: { room }) and handle it in defineService's channels
  this.defineChannel(
    "input",
    "Read",
    (payload, ctx) => {
      // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
      this.sim.applyInput(ctx.userId, payload);
    },
    {
      schema: gameInputSchema,
      ratePerSecond: GAME_TICK_RATE * 1.5,
      burst: GAME_TICK_RATE * 3,
      requireRoom: () => serviceRoom("gameService", GLOBAL_WORLD_ID),
    },
  );
}

function installAdmin(): void {
  // quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
  this.installAdminMethods({
    expose: { list: true, get: true, update: true, delete: false, create: false },
    access: {
      list: "Admin",
      get: "Admin",
      create: "Admin",
      update: "Admin",
      delete: "Admin",
      setEntryACL: "Admin",
      getSubscribers: "Admin",
      reemit: "Admin",
      unsubscribeAll: "Admin",
    },
    schema: adminGameWorldSchema,
    displayName: "Game Worlds",
    tableColumns: ["id", "slug", "name", "createdAt"],
  });
}

/**
 * GameService — the real-time game server for the demo snake world.
 *
 * Commands (join/respawn/leave) are ordinary typed+ACL'd methods, callable
 * identically from React and from the Godot client. The high-frequency
 * traffic uses quickdraw channels: client input arrives on the "input"
 * channel (fire-and-forget, token-bucketed), world snapshots go out as
 * volatile broadcasts to the world's service room at GAME_TICK_RATE.
 *
 * The simulation itself (GameWorldSim) is pure and in-memory — the database
 * only sees world/chat bootstrap and throttled score writes, never the tick
 * path. See .claude/rules/game-patterns.md.
 */
export const gameService = qd.defineService(gameContract, {
  model: "gameWorld",
  // quickdraw-migrate: review [access-override] 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
  access: resolver({ levelsFor: () => ({}) }),
  methods: {
    joinGame: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }): Promise<GameBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");

        const [user, world] = await Promise.all([
          db.user.findUnique({ where: { id: ctx.principal.userId }, select: { name: true } }),
          db.gameWorld.findUnique({ where: { id: GLOBAL_WORLD_ID } }),
        ]);

        // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
        const { meta, isNew } = this.sim.addPlayer(ctx.principal.userId, user?.name ?? null);
        // quickdraw-migrate: review [this] this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
        this.playingUsers.add(ctx.principal.userId);

        await ensureChatMembership(world?.chatId, ctx.principal.userId);

        if (isNew) {
          // quickdraw-migrate: review [emit] room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
          this.emitToRoom(
            serviceRoom("gameService", GLOBAL_WORLD_ID),
            GAME_EVENTS.playerJoined,
            meta,
          );
        }

        return { ...buildWorldBootstrap(world?.chatId ?? null), you: meta };
      },
    },
    watchWorld: {
      access: "public",
      handler: async ({ input, ctx, db }): Promise<WorldBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const world = await db.gameWorld.findUnique({ where: { id: GLOBAL_WORLD_ID } });
        if (ctx.principal?.userId) {
          await ensureChatMembership(world?.chatId, ctx.principal?.userId);
        } else {
          // quickdraw-migrate: review [context] ctx.socketId was a field of 4.x's method context (userId, socketId, serviceAccess); 5.0's ctx has principal, requestId, log and transport
          joinSpectator(ctx.socketId);
        }
        return buildWorldBootstrap(world?.chatId ?? null);
      },
    },
    respawn: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: ({ input, ctx }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
        this.sim.respawn(ctx.principal.userId);
        return Promise.resolve({ ok: true as const });
      },
    },
    leaveGame: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: ({ input, ctx }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        // quickdraw-migrate: review [this] this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
        this.playingUsers.delete(ctx.principal.userId);
        // quickdraw-migrate: review [this] this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
        if (this.sim.removePlayer(ctx.principal.userId)) {
          // quickdraw-migrate: review [emit] room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
          this.emitToRoom(serviceRoom("gameService", GLOBAL_WORLD_ID), GAME_EVENTS.playerLeft, {
            id: ctx.principal.userId,
          });
        }
        return Promise.resolve({ ok: true as const });
      },
    },
    getWorld: {
      access: "public",
      handler: async ({ input, db }) => {
        const world = await db.gameWorld.findUnique({
          where: { slug: input.slug },
          select: { id: true, name: true, chatId: true },
        });
        return world ?? null;
      },
    },
    getMyBest: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const score = await db.gameScore.findUnique({
          where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: ctx.principal.userId } },
          select: { bestLength: true },
        });
        return { bestLength: score?.bestLength ?? 0 };
      },
    },
    getHighScores: {
      access: "public",
      handler: async ({ input, db }): Promise<HighScoreEntry[]> => {
        if (input.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const rows = await db.gameScore.findMany({
          where: { worldId: GLOBAL_WORLD_ID },
          orderBy: { bestLength: "desc" },
          take: Math.min(input.limit ?? 25, 100),
          include: { user: { select: { name: true, image: true, isGuest: true } } },
        });
        return rows.map((row) => ({
          userId: row.userId,
          name: row.user.name,
          image: row.user.image,
          isGuest: row.user.isGuest,
          bestLength: row.bestLength,
        }));
      },
    },
  },
});
