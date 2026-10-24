import type {
  GameBootstrap,
  HighScoreEntry,
  PartyBootstrap,
  PartyHosted,
  WorldBootstrap,
} from "@project/shared";
import {
  GLOBAL_WORLD_ID,
  GLOBAL_WORLD_ROOM,
  GAME_TICK_RATE,
  PARTY_WORLD_KIND,
  gameContract,
  partyRoom,
} from "@project/shared";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { admin, anyOf, everyone, owner } from "@fitzzero/quickdraw-core/server";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import {
  PARTY_BOUNDS,
  assertInParty,
  assertRoomInParty,
  createPartyRow,
  endParties,
  enterPartyRoom,
  hostedParties,
  oneHostPartyAtATime,
  onPartyHostLeave,
  openParty,
  openPartyForJoin,
  partyRoomsLeft,
  partySocketLeft,
} from "./party.js";
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

/** A party without a host has ended: its host left, or the server restarted. */
function partyEnded(): never {
  throw new QuickdrawError("NOT_FOUND", "That party has ended");
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
 * and the methods that act in one ask `{ entry: "Read" }` of it. A party's
 * host has Admin on its row (closeParty). Other writes need a service-wide
 * grant (the admin kit's Admin).
 */
const anyWorld = anyOf(everyone("Read"), owner("hostUserId"));

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
  // The high scores. A write to the service's model or to one in `writes`
  // changes its service topic, which anyone may watch, and the score queries
  // hear GameScore's only. The world chat's memberships are the chat
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
    hostParty: {
      // any signed-in user, guests too, as joinGame: names no row
      access: "authenticated",
      handler: async ({ ctx, db }): Promise<PartyHosted> => {
        // the host serves the party over peer links, which only a socket has
        const { socketId } = ctx;
        if (socketId === undefined) {
          throw new QuickdrawError("VALIDATION", "Host a party over a socket");
        }
        const hostUserId = ctx.principal.userId;
        return await oneHostPartyAtATime(hostUserId, async () => {
          // a user hosts one party at a time: their other parties end
          await endParties(db, ctx, await hostedParties(db, hostUserId), "partyClosed");
          const world = await createPartyRow(db, hostUserId);
          try {
            // its chat, the chat service's to make: the host is its Admin
            const { id: chatId } = await ctx.services.chatService.createChat({
              title: `🎉 Party ${world.code}`,
            });
            await db.gameWorld.update({
              where: { id: world.id },
              data: { chatId },
              select: { id: true },
            });
            // in the room first (and out of any other party's): setHost
            // refuses a socket outside it
            const room = partyRoom(world.id);
            enterPartyRoom(ctx.rooms, socketId, room);
            if (!ctx.rooms.setHost(room)) throw new QuickdrawError("INTERNAL", "No host was set");
            return { worldId: world.id, code: world.code, chatId };
          } catch (error) {
            // a party nobody hosts has ended: its code is free again
            await endParties(db, ctx, [world.id], "partyClosed");
            throw error;
          }
        });
      },
    },
    joinParty: {
      // any signed-in user with the code: the code is how a host invites
      access: "authenticated",
      handler: async ({ input, ctx, db }): Promise<PartyBootstrap> => {
        // the world comes from the host over a peer link, which only a socket has
        if (ctx.socketId === undefined) {
          throw new QuickdrawError("VALIDATION", "Join a party over a socket");
        }
        const userId = ctx.principal.userId;
        const party = await openPartyForJoin(db, userId, input.code);
        const room = partyRoom(party.id);
        if (ctx.rooms.hostOf(room) === null) partyEnded();
        await assertRoomInParty(ctx.presence, room, userId);
        // The calling socket hears the party, and may link to its host
        enterPartyRoom(ctx.rooms, ctx.socketId, room);
        // the host may have left while this call waited, before the socket
        // was in the room to hear it
        const hostSocketId = ctx.rooms.hostOf(room);
        if (hostSocketId === null) {
          ctx.rooms.leave(room);
          partyEnded();
        }
        // its chat, which only the users its room holds may join
        const { chatId } = await ctx.services.chatService.joinWorldChat({ worldId: party.id });
        // The world itself (snakes, food, names) comes from the host's streams
        return {
          worldId: party.id,
          chatId,
          code: party.code,
          hostUserId: party.hostUserId,
          hostSocketId,
          tick: 0,
          tickRate: GAME_TICK_RATE,
          bounds: PARTY_BOUNDS,
          players: [],
          snaps: [],
          food: [],
        };
      },
    },
    playParty: {
      // a signed-in user, on a world, as joinGame; in a party, a user its
      // room holds (joinParty first: the code is the invitation)
      access: IN_WORLD,
      handler: async ({ input, ctx, db }) => {
        const [party, user] = await Promise.all([
          openParty(db, input.worldId),
          db.user.findUnique({ where: { id: ctx.principal.userId }, select: { name: true } }),
        ]);
        const room = partyRoom(party.id);
        await assertInParty(ctx.presence, room, ctx.principal.userId);
        if (ctx.rooms.hostOf(room) === null) partyEnded();
        // The calling socket hears the party (on every connection, as joinGame)
        enterPartyRoom(ctx.rooms, ctx.socketId, room);
        // The host spawns the snake on the server's word, named as the server knows the user
        ctx.rooms.emit(room, gameContract, "partyPlayer", {
          worldId: party.id,
          id: ctx.principal.userId,
          name: user?.name ?? null,
        });
        return { ok: true as const };
      },
    },
    leaveParty: {
      // a signed-in user, on a world, as leaveGame; leaving a party the
      // caller is not in (or one that ended) does nothing
      access: IN_WORLD,
      handler: async ({ input, ctx }) => {
        await ctx.rooms.leave(partyRoom(input.worldId), { userId: ctx.principal.userId });
        return { ok: true as const };
      },
    },
    closeParty: {
      // the party's host, whom the policy gives Admin on the row (as a
      // service-wide Admin grant)
      access: { entry: "Admin", id: "worldId" },
      handler: async ({ input, ctx, db }) => {
        const party = await openParty(db, input.worldId);
        await endParties(db, ctx, [party.id], "partyClosed");
        return { ok: true as const };
      },
    },
    getWorld: {
      access: "public",
      handler: async ({ input, db }) => {
        const world = await db.gameWorld.findUnique({
          where: { slug: input.slug },
          select: { id: true, name: true, chatId: true, kind: true },
        });
        // a server's world: a party is found by its code alone (joinParty)
        if (world === null || world.kind === PARTY_WORLD_KIND) return null;
        return { id: world.id, name: world.name, chatId: world.chatId };
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
    // Fire-and-forget, one message per client tick: the contract's token
    // bucket and room requirement drop what is over the rate or from a socket
    // outside the world; each message repeats the unacknowledged frames
    // before its newest, so the next one carries a lost one's
    input: (payload, ctx) => {
      activeGameRuntime()?.sim.queueInputs(ctx.principal.userId, payload.frames);
    },
  },
  streams: {
    world: {
      // Each subscriber starts from the current world (a keyframe: every
      // snake, all the food), read from the running sim, never the
      // database: it runs on every subscribe
      seed: (worldId) => {
        const runtime = activeGameRuntime();
        return worldId === GLOBAL_WORLD_ID && runtime !== undefined ? [runtime.keyframe()] : [];
      },
      // 20 snapshots a second the loop builds itself: checked against the
      // schema where outputs are (development and tests), not in production
      validate: "development",
    },
  },
  // The score queries watch the service topic narrowed to GameScore (a
  // stored score changes it; an edit of a world row changes it too, which
  // they skip), and they are public: anyone may watch it
  watchAccess: "public",
  // A player whose last socket left the world's room leaves the sim, and a
  // party's host hears of a user whose last socket left its room, in every
  // server this service runs in
  onRoomLeave: (leave, ctx) => {
    onGameRoomLeave(leave, ctx);
    partySocketLeft(leave.socketId, leave.rooms);
    if (leave.principal !== null) partyRoomsLeft(leave.principal.userId, leave.rooms);
  },
  // A party ends when its host leaves (no other player takes over)
  onHostLeave: onPartyHostLeave,
});
