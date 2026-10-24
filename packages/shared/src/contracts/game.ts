// The contract of gameService: the world entity, the game's commands, the
// world's realtime half (the input channel, the snapshot stream and the
// world's events) and the admin kit. Each schema below
// satisfies the wire type of the same shape in ../types/game.ts, which
// documents the protocol for the Godot client.

import { admin, defineContract, mutation, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  GAME_INPUT_FRAMES,
  GAME_TICK_RATE,
  GLOBAL_WORLD_ROOM,
  PARTY_ROOM_PREFIX,
  partyRoom,
  type FoodDelta,
  type FoodDTO,
  type GameBootstrap,
  type GameDeathEvent,
  type GameInput,
  type GameInputs,
  type GamePlayerMeta,
  type HighScoreEntry,
  type LeaderboardEntry,
  type PackedWorldItem,
  type PartyBootstrap,
  type PartyEvent,
  type PartyHosted,
  type PartyPlayer,
  type PlayerSnap,
  type WorldBootstrap,
  type WorldSnapshot,
} from "../types/game.js";
import { isoDateSchema } from "./helpers.js";

const worldScopedSchema = z.object({
  worldId: z.string().min(1),
});

const getWorldSchema = z.object({
  slug: z.string().min(1).max(64),
});

const highScoresSchema = z.object({
  worldId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * The highest frame seq: far below 2^32, the ack's width in a packed
 * snapshot, which the server's coasts (20 a second) carry the ack on toward.
 */
const MAX_INPUT_SEQ = 2 ** 31 - 1;

/** One input frame: a desired direction and boost, numbered for reconciliation. */
const gameInputSchema = z.object({
  seq: z.number().int().min(0).max(MAX_INPUT_SEQ),
  dx: z.number(),
  dy: z.number(),
  boost: z.boolean(),
}) satisfies z.ZodType<GameInput>;

/** One input message: the newest frame last, with up to three unacknowledged ones before it. */
const gameInputsSchema = z.object({
  frames: z.array(gameInputSchema).min(1).max(GAME_INPUT_FRAMES),
}) satisfies z.ZodType<GameInputs>;

const gamePlayerMetaSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  hue: z.number(),
}) satisfies z.ZodType<GamePlayerMeta>;

const playerSnapSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  dx: z.number(),
  dy: z.number(),
  len: z.number(),
  boost: z.boolean(),
  ack: z.number().int(),
}) satisfies z.ZodType<PlayerSnap>;

const foodSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  v: z.number(),
}) satisfies z.ZodType<FoodDTO>;

/** The food one tick changed. */
const foodDeltaSchema = z.object({
  tick: z.number().int(),
  spawned: z.array(foodSchema).optional(),
  eaten: z.array(z.string()).optional(),
}) satisfies z.ZodType<FoodDelta>;

/**
 * One tick of the world: every snake's head, and the food changes of the
 * last six ticks. What a world stream item decodes to (SnapshotDecoder).
 */
export const worldSnapshotSchema = z.object({
  tick: z.number().int(),
  t: z.number().optional(),
  players: z.array(playerSnapSchema),
  food: z.array(foodDeltaSchema).optional(),
}) satisfies z.ZodType<WorldSnapshot>;

/** A world stream item: one snapshot, packed and base64 (game/snapshotCodec.ts). */
const packedWorldItemSchema = z.object({
  b: z.string().min(1),
}) satisfies z.ZodType<PackedWorldItem>;

const gameDeathSchema = z.object({
  id: z.string(),
  len: z.number(),
}) satisfies z.ZodType<GameDeathEvent>;

const leaderboardEntrySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  len: z.number(),
}) satisfies z.ZodType<LeaderboardEntry>;

/** A world's full state without the caller's player: what spectating starts from. */
export const worldBootstrapSchema = z.object({
  worldId: z.string(),
  chatId: z.string().nullable(),
  tick: z.number().int(),
  tickRate: z.number(),
  bounds: z.object({ w: z.number(), h: z.number() }),
  players: z.array(gamePlayerMetaSchema),
  snaps: z.array(playerSnapSchema),
  food: z.array(foodSchema),
}) satisfies z.ZodType<WorldBootstrap>;

/** A world's full state plus the caller's own player: what joining answers. */
export const gameBootstrapSchema = worldBootstrapSchema.extend({
  you: gamePlayerMetaSchema,
}) satisfies z.ZodType<GameBootstrap>;

/** A party's join code, as a player types it (joinParty trims it and reads it in capitals). */
const partyCodeSchema = z.object({
  code: z.string().min(1).max(16),
});

/** What hostParty answers: the party's world, its code and its chat. */
const partyHostedSchema = z.object({
  worldId: z.string(),
  code: z.string(),
  chatId: z.string().nullable(),
}) satisfies z.ZodType<PartyHosted>;

/** What joinParty answers: the bootstrap's shape without the world, which the host sends, and who hosts. */
export const partyBootstrapSchema = worldBootstrapSchema.extend({
  code: z.string(),
  hostUserId: z.string().nullable(),
  hostSocketId: z.string().nullable(),
}) satisfies z.ZodType<PartyBootstrap>;

/** One item of a party's events stream, from its host. */
const partyEventSchema = z.discriminatedUnion("kind", [
  gamePlayerMetaSchema.extend({ kind: z.literal("joined") }),
  z.object({ kind: z.literal("left"), id: z.string() }),
  gameDeathSchema.extend({ kind: z.literal("death") }),
  z.object({
    kind: z.literal("leaderboard"),
    entries: z.array(leaderboardEntrySchema),
    rttMs: z.record(z.string(), z.number()),
    fairLinkMs: z.number().nullable(),
  }),
]) satisfies z.ZodType<PartyEvent>;

/** The server's word that a user asked to play in a party. */
const partyPlayerSchema = z.object({
  worldId: z.string(),
  id: z.string(),
  name: z.string().nullable(),
}) satisfies z.ZodType<PartyPlayer>;

const partyScopedEventSchema = z.object({ worldId: z.string(), id: z.string() });

const partyEndedSchema = z.object({ worldId: z.string() });

/** One row of a world's high scores. */
export const highScoreEntrySchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  isGuest: z.boolean(),
  bestLength: z.number().int(),
}) satisfies z.ZodType<HighScoreEntry>;

/**
 * A game world row. The simulation's state lives in memory, never in the row;
 * the row gives the world its chat and an admin surface.
 */
export const gameWorldSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** "server" (the server runs it) or "party" (a player's browser hosts it). */
  kind: z.string(),
  /** A party's join code; null for a server world. */
  code: z.string().nullable(),
  /** The user who hosts a party; null for a server world. */
  hostUserId: z.string().nullable(),
  /** When a party ended; null while it is open, and for a server world. */
  closedAt: isoDateSchema.nullable(),
  chatId: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const okSchema = z.object({ ok: z.literal(true) });

export const gameContract = defineContract("gameService", {
  describe:
    "The realtime snake game: spectate or join a world, steer and respawn a snake, and read the high scores.",
  entity: gameWorldSchema,
  methods: {
    joinGame: mutation({
      input: worldScopedSchema,
      output: gameBootstrapSchema,
      describe:
        "Spawns the caller's snake in a world, puts the calling socket in the world's room, and answers the world's state with it.",
    }),
    // A query although it joins the caller to the world's chat and puts the
    // calling socket in the world's room: both joins are idempotent (the chat
    // membership is written the first time only), so fetching it again is
    // safe and changes nothing, and the web app reads it as a query.
    watchWorld: query({
      input: worldScopedSchema,
      output: worldBootstrapSchema,
      describe:
        "Answers a world's state without spawning, and puts the calling socket in the world's room, for spectating.",
    }),
    respawn: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe: "Respawns the caller's snake after it died.",
    }),
    leaveGame: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe: "Takes the caller's snake out of the world; their sockets stay as spectators.",
    }),
    // A party: a world one player's browser hosts (host mode). The server
    // keeps its row, code, room and chat, and names its host; the world
    // itself runs in the host's page, which serves partyInput, partyWorld
    // and partyEvents over peer links. What the host sends is one player's
    // word: the server trusts none of it and stores no party score.
    hostParty: mutation({
      input: z.object({}),
      output: partyHostedSchema,
      describe:
        "Starts a party the caller's browser hosts, over a socket: makes its world row, a code to join it by and its chat, puts the calling socket in the party's room (out of any other party's) and makes it the room's host. Ends the caller's other open parties first; one call at a time per user (CONFLICT).",
    }),
    joinParty: query({
      input: partyCodeSchema,
      output: partyBootstrapSchema,
      describe:
        "Finds an open party by its code and puts the calling socket (a socket only) in the party's room, out of any other party's: answers its world, chat and host. The snakes and the food come from the host, over partyWorld. NOT_FOUND for a code no open party holds or a party without a host, RATE_LIMITED after too many wrong codes, CONFLICT for a full party.",
    }),
    playParty: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe:
        "Asks a party's host to spawn the caller's snake, or respawn it after a death: puts the calling socket in the party's room and tells the room (partyPlayer). For a user the party's room holds (joinParty first: the code is the invitation).",
    }),
    leaveParty: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe:
        "Takes every socket of the caller out of a party's room; the host takes their snake out. A host who leaves ends the party.",
    }),
    closeParty: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe:
        "Ends a party, for its host (or a service-wide Admin): tells the room (partyClosed), takes everyone out of it and frees its code.",
    }),
    getWorld: query({
      input: getWorldSchema,
      output: z
        .object({ id: z.string(), name: z.string(), chatId: z.string().nullable() })
        .nullable(),
      describe:
        "Reads a server's world by its slug (its id, name and chat), or null: a party is found by its code alone (joinParty).",
    }),
    // The scores are GameScore rows, which no service owns: gameService
    // writes them, so a stored score changes its service topic. Both queries
    // watch that topic narrowed to the scores: the client reads them again
    // after a flush that wrote a GameScore, not after a world row's edit
    getMyBest: query({
      input: worldScopedSchema,
      output: z.object({ bestLength: z.number().int() }),
      watch: { service: ["gameScore"] },
      describe: "The caller's best length in a world (0 before their first death).",
    }),
    getHighScores: query({
      input: highScoresSchema,
      output: z.array(highScoreEntrySchema),
      watch: { service: ["gameScore"] },
      describe: "A world's best lengths, highest first (25 unless a limit is given).",
    }),
    // The admin screens: the world rows (their names and chats), for holders
    // of a service-wide Admin grant. Worlds are made by the server, never here.
    ...admin.contract({
      entity: gameWorldSchema,
      sort: ["createdAt", "name", "slug"],
      // its slug is how every client finds it (GLOBAL_WORLD_SLUG), and its
      // chat is the server's to make and link
      editable: ["name"],
      expose: [
        "adminList",
        "adminGet",
        "adminUpdate",
        "adminMeta",
        "adminSubscribers",
        "adminReemit",
      ],
    }),
  },
  channels: {
    // One world, so one room by name; a game of many would require
    // `{ room: { prefix: "world:" } }` and read the world from `ctx.room`.
    input: {
      describe:
        "The caller's steering, one message per tick: the newest frame (a direction and a boost) last, with up to three unacknowledged ones before it, stepped in order, one a tick unless a backlog builds; dropped unless the sending socket is signed in and joined the world with watchWorld or joinGame.",
      payload: gameInputsSchema,
      ratePerSecond: GAME_TICK_RATE * 1.5,
      burst: GAME_TICK_RATE * 3,
      requires: { room: GLOBAL_WORLD_ROOM },
    },
    // Served by the party's host, never the server: a player's client sends
    // it to the host of the one party room its socket is in, over its link
    partyInput: {
      describe:
        "The caller's steering in a party, as input is the world's: to the party's host over the caller's peer link (its fast channel), never to the server. It requires a party's room (any room named party:<worldId>, one per socket); the host drops it from a socket outside the room.",
      payload: gameInputsSchema,
      ratePerSecond: GAME_TICK_RATE * 1.5,
      burst: GAME_TICK_RATE * 3,
      requires: { room: { prefix: PARTY_ROOM_PREFIX } },
      serve: "host",
    },
  },
  streams: {
    // Every tick of a world, volatile (a backed-up client drops frames), each
    // repeating the food changes of the last six ticks, packed (a client's
    // SnapshotDecoder unpacks them). Its seed is the
    // current world, which the service computes for each subscriber (every
    // snake, and all the food in one entry), so a new subscriber places
    // everything at once, and one that missed more than six ticks subscribes
    // again. Public: signed-out visitors spectate, and clients subscribe
    // before they join the world's room (a room form, `access: { room }`,
    // would refuse them until then).
    world: {
      describe:
        "Every tick of a world, starting from the whole world (every snake and all the food); anyone may watch, signed out too. Each item packs one snapshot into bytes, base64 in `b`: decode it with @project/shared's SnapshotDecoder, one per client.",
      item: packedWorldItemSchema,
      scope: "worldId",
      volatile: true,
      access: "public",
    },
    // A party's two feeds, pushed by its host over peer links: only the
    // party room's sockets subscribe, and the server never sees an item
    partyWorld: {
      describe:
        "Every tick of a party's world, from its host: a snapshot as the world stream unpacks to, volatile; the seed is the world now. Only sockets in the party's room subscribe.",
      item: worldSnapshotSchema,
      scope: "worldId",
      seed: 1,
      volatile: true,
      access: { room: partyRoom },
      serve: "host",
    },
    partyEvents: {
      describe:
        "A party's joins, leaves, deaths and leaderboard, from its host, reliable and in order: what the world's events are to the server's world. The seed names every player.",
      item: partyEventSchema,
      scope: "worldId",
      access: { room: partyRoom },
      serve: "host",
    },
  },
  // Sent to the world's room, reliably
  events: {
    playerJoined: {
      describe: "A player joined the world, with their name and the hue of their snake.",
      payload: gamePlayerMetaSchema,
    },
    playerLeft: {
      describe: "A player left the world.",
      payload: z.object({ id: z.string() }),
    },
    death: {
      describe: "A snake died, with the length it reached.",
      payload: gameDeathSchema,
    },
    leaderboard: {
      describe: "The world's longest snakes, once a second while the world runs.",
      payload: z.array(leaderboardEntrySchema),
    },
    // A party's room hears these from the server; its host acts on the first two
    partyPlayer: {
      describe:
        "A user asked to play in a party (playParty), with their name: the host spawns their snake, or respawns it.",
      payload: partyPlayerSchema,
    },
    partyPlayerLeft: {
      describe: "A user's last socket left a party's room: the host takes their snake out.",
      payload: partyScopedEventSchema,
    },
    hostLeft: {
      describe: "A party's host left its room or disconnected: the party has ended.",
      payload: partyEndedSchema,
    },
    partyClosed: {
      describe:
        "A party ended: its host closed it (closeParty) or hosted another party, or a service-wide Admin closed it.",
      payload: partyEndedSchema,
    },
  },
});
