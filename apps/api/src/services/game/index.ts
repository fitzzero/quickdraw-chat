import type { GameBootstrap, HighScoreEntry, WorldBootstrap } from "@project/shared";
import { GAME_EVENTS, GLOBAL_WORLD_ID, GAME_TICK_RATE, gameContract } from "@project/shared";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { resolver } from "@fitzzero/quickdraw-core/server";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import { broadcast, gameRuntime, type GameRuntime } from "./runtime.js";

type Db = typeof appDb;

// quickdraw-game: the minimal 5.0 port. The methods run on 5.0 and keep the
// sim in `runtime.ts`; the 4.x wire this service also had (the world room,
// its input channel and broadcasts, presence-anchored players, spectators,
// the admin screen) is ported with the game itself (child 4). Its review
// markers stay below.

// quickdraw-migrate: review [channel] 4.x channel: declare it in the contract's channels ({ payload, ratePerSecond, burst, requires }; requireRoom becomes requires: { room }) and handle it in defineService's channels
// (4.x: channel "input" at Read, payload { seq, dx, dy, boost }, ratePerSecond
// GAME_TICK_RATE * 1.5, burst GAME_TICK_RATE * 3, requireRoom: the world's room;
// handler sim.applyInput(userId, payload))

// quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
// (4.x: list, get and update of game worlds for service Admins, "Game Worlds")

// quickdraw-migrate: review [this] 4.x overrode unsubscribeSocket(socket) (a disconnect) and unsubscribe(entryId, socket) (leaving the world's row) to call maybeRemovePlayer(socket.userId) after the base class removed the socket: run it wherever a player's last socket leaves the world
// (4.x removed a player once no socket of theirs stayed in the world room, and
// broadcast playerLeft; until the port a player leaves only through leaveGame)

// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
// (4.x checkAccess: any signed-in user had Read on every world, which gated
// the world room; writes needed a service grant)

function unknownWorld(): never {
  throw new QuickdrawError("NOT_FOUND", "Unknown world");
}

/** Idempotent membership in the world chat (the in-game chat overlay). */
async function ensureChatMembership(
  db: Db,
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

function buildWorldBootstrap(runtime: GameRuntime, chatId: string | null): WorldBootstrap {
  const { sim } = runtime;
  const state = sim.getBootstrapState();
  return {
    worldId: GLOBAL_WORLD_ID,
    chatId,
    tick: sim.tick,
    tickRate: GAME_TICK_RATE,
    bounds: { w: sim.tunables.worldWidth, h: sim.tunables.worldHeight },
    players: state.players,
    snaps: state.snaps,
    food: state.food,
  };
}

/**
 * GameService — the real-time game server for the demo snake world.
 *
 * Commands (join/respawn/leave) are ordinary typed methods, callable
 * identically from React and from the Godot client. The simulation itself
 * (GameWorldSim) is pure and in-memory — the database only sees world/chat
 * bootstrap and throttled score writes, never the tick path. See
 * .claude/rules/game-patterns.md.
 */
export const gameService = qd.defineService(gameContract, {
  model: "gameWorld",
  // quickdraw-migrate: review [access-override] 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
  access: resolver({ levelsFor: () => ({}) }),
  // the world chat's memberships and the high scores
  writes: ["chatMember", "gameScore"],
  methods: {
    joinGame: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }): Promise<GameBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        const runtime = gameRuntime(db);
        const [user, world] = await Promise.all([
          db.user.findUnique({ where: { id: ctx.principal.userId }, select: { name: true } }),
          db.gameWorld.findUnique({ where: { id: GLOBAL_WORLD_ID }, select: { chatId: true } }),
        ]);
        const { meta, isNew } = runtime.sim.addPlayer(ctx.principal.userId, user?.name ?? null);
        runtime.playingUsers.add(ctx.principal.userId);
        await ensureChatMembership(db, world?.chatId, ctx.principal.userId);
        if (isNew) {
          broadcast(GAME_EVENTS.playerJoined, meta);
        }
        return { ...buildWorldBootstrap(runtime, world?.chatId ?? null), you: meta };
      },
    },
    watchWorld: {
      access: "public",
      handler: async ({ input, ctx, db }): Promise<WorldBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        const world = await db.gameWorld.findUnique({
          where: { id: GLOBAL_WORLD_ID },
          select: { chatId: true },
        });
        if (ctx.principal !== null) {
          await ensureChatMembership(db, world?.chatId, ctx.principal.userId);
        }
        // quickdraw-migrate: review [context] ctx.socketId was a field of 4.x's method context (userId, socketId, serviceAccess); 5.0's ctx has principal, requestId, log and transport
        // (4.x joined an anonymous spectator's socket to the world room here: ctx.rooms.join after the port)
        return buildWorldBootstrap(gameRuntime(db), world?.chatId ?? null);
      },
    },
    respawn: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: ({ input, ctx, db }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        gameRuntime(db).sim.respawn(ctx.principal.userId);
        return Promise.resolve({ ok: true as const });
      },
    },
    leaveGame: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: ({ input, ctx, db }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        const runtime = gameRuntime(db);
        runtime.playingUsers.delete(ctx.principal.userId);
        if (runtime.sim.removePlayer(ctx.principal.userId)) {
          broadcast(GAME_EVENTS.playerLeft, { id: ctx.principal.userId });
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
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
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
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
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
