import type { GameBootstrap, HighScoreEntry, WorldBootstrap } from "@project/shared";
import { GLOBAL_WORLD_ID, GLOBAL_WORLD_ROOM, GAME_TICK_RATE, gameContract } from "@project/shared";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { admin, everyone } from "@fitzzero/quickdraw-core/server";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import {
  activeGameRuntime,
  gameRuntime,
  onGameRoomLeave,
  removePlayer,
  type GameRuntime,
} from "./runtime.js";

type Db = typeof appDb;

function unknownWorld(): never {
  throw new QuickdrawError("NOT_FOUND", "Unknown world");
}

/** The world's chat (the in-game chat overlay), read for a caller who is not signed in. */
async function worldChatId(db: Db): Promise<string | null> {
  const world = await db.gameWorld.findUnique({
    where: { id: GLOBAL_WORLD_ID },
    select: { chatId: true },
  });
  return world?.chatId ?? null;
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
 * Every signed-in user reads every world: a world is public game content,
 * and the methods that act in one ask `{ entry: "Read" }` of it. Writes need
 * a service-wide grant (the admin kit's Admin).
 */
const anyWorld = everyone("Read");

/** `{ entry: "Read" }` on the world the input names: every signed-in user, by the policy above. */
const IN_WORLD = { entry: "Read", id: "worldId" } as const;

/**
 * GameService — the real-time game server for the demo snake world.
 *
 * Commands (join/respawn/leave) are ordinary typed methods, callable
 * identically from React and from the Godot client. watchWorld and joinGame
 * put the calling socket in the world's room, which carries the world's
 * events and gates the `input` channel, and whose last socket of a player
 * takes them out of the sim when it leaves (`onRoomLeave`); snapshots go out
 * on the `world` stream, whose subscribers start from the current world
 * (`streams.world.seed`). The simulation itself (GameWorldSim, in
 * runtime.ts) is pure and in-memory — the database only sees world/chat
 * bootstrap and score writes, never the tick path. See
 * .claude/rules/game-patterns.md.
 */
export const gameService = qd.defineService(gameContract, {
  model: "gameWorld",
  access: anyWorld,
  // The high scores. Only the game's own writes change its service topic,
  // which anyone may watch: the world chat's memberships are the chat
  // service's (`joinWorldChat`, called through ctx.services)
  writes: ["gameScore"],
  methods: {
    joinGame: {
      // a signed-in user, on a world (the policy gives every signed-in user
      // Read on every world)
      access: IN_WORLD,
      handler: async ({ input, ctx, db }): Promise<GameBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        const runtime = gameRuntime(db);
        // the player is in the world's chat too (written once, by the chat service)
        const [user, { chatId }] = await Promise.all([
          db.user.findUnique({ where: { id: ctx.principal.userId }, select: { name: true } }),
          ctx.services.chatService.joinWorldChat({ worldId: GLOBAL_WORLD_ID }),
        ]);
        // The calling socket hears the world and may send input; the player
        // stays while any socket of theirs is in the room (onGameRoomLeave)
        ctx.rooms.join(GLOBAL_WORLD_ROOM);
        const { meta, isNew } = runtime.sim.addPlayer(ctx.principal.userId, user?.name ?? null);
        runtime.playingUsers.add(ctx.principal.userId);
        if (isNew) {
          ctx.rooms.emit(GLOBAL_WORLD_ROOM, gameContract, "playerJoined", meta);
        }
        return { ...buildWorldBootstrap(runtime, chatId), you: meta };
      },
    },
    watchWorld: {
      // spectating is open to everyone, signed in or not (the guest dialog
      // sits over a live world)
      access: "public",
      handler: async ({ input, ctx, db }): Promise<WorldBootstrap> => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        // a signed-in spectator is in the world's chat too (the overlay works
        // before they join), written once, by the chat service
        const chatId =
          ctx.principal === null
            ? await worldChatId(db)
            : (await ctx.services.chatService.joinWorldChat({ worldId: GLOBAL_WORLD_ID })).chatId;
        // The calling socket hears the world's events and counts as its
        // audience, signed in or not; an anonymous one never sends input
        // (channels need a principal)
        ctx.rooms.join(GLOBAL_WORLD_ROOM);
        return buildWorldBootstrap(gameRuntime(db), chatId);
      },
    },
    respawn: {
      // a signed-in user, on a world, as joinGame
      access: IN_WORLD,
      handler: ({ input, ctx, db }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        gameRuntime(db).sim.respawn(ctx.principal.userId);
        return Promise.resolve({ ok: true as const });
      },
    },
    leaveGame: {
      // a signed-in user, on a world, as joinGame
      access: IN_WORLD,
      handler: ({ input, ctx, db }) => {
        if (input.worldId !== GLOBAL_WORLD_ID) unknownWorld();
        removePlayer(gameRuntime(db), ctx.principal.userId);
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
      // a signed-in user's own score, on a world
      access: IN_WORLD,
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
      // the /scores page and the pre-game dialog, signed in or not
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
    ...admin.handlers(gameContract, {
      displayName: "Game Worlds",
      fieldOverrides: { chatId: { showInTable: false }, updatedAt: { showInTable: false } },
    }),
  },
  channels: {
    // Fire-and-forget at about the tick rate: the contract's token bucket and
    // room requirement drop what is over the rate or from a socket outside
    // the world; the next frame supersedes a lost one
    input: (payload, ctx) => {
      activeGameRuntime()?.sim.applyInput(ctx.principal.userId, payload);
    },
  },
  streams: {
    world: {
      // Each subscriber starts from the current world (a keyframe: every
      // snake, all the food), read from the running sim, never the
      // database: it runs on every subscribe
      seed: (worldId) => {
        const runtime = activeGameRuntime();
        return worldId === GLOBAL_WORLD_ID && runtime !== undefined ? [runtime.sim.keyframe()] : [];
      },
      // 20 snapshots a second the loop builds itself: checked against the
      // schema where outputs are (development and tests), not in production
      validate: "development",
    },
  },
  // The score queries watch the service topic (a stored score changes it),
  // and they are public: anyone may watch it
  watchAccess: "public",
  // A player whose last socket left the world's room leaves the sim, in
  // every server this service runs in
  onRoomLeave: onGameRoomLeave,
});
