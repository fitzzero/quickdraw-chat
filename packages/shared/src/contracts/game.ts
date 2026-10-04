// The contract of gameService: the world entity, the game's commands, the
// world's realtime half (the input channel, the snapshot stream and the
// world's events) and the admin kit. Each schema below
// satisfies the wire type of the same shape in ../types/game.ts, which
// documents the protocol for the Godot client.

import { admin, defineContract, mutation, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  GAME_TICK_RATE,
  GLOBAL_WORLD_ROOM,
  type FoodDTO,
  type GameBootstrap,
  type GameDeathEvent,
  type GameInput,
  type GamePlayerMeta,
  type HighScoreEntry,
  type LeaderboardEntry,
  type PlayerSnap,
  type ScoreSavedEvent,
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

/** One input frame: a desired direction and boost, numbered for reconciliation. */
const gameInputSchema = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dx: z.number(),
  dy: z.number(),
  boost: z.boolean(),
}) satisfies z.ZodType<GameInput>;

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

/** One tick of the world: every snake's head, and the food that came and went. */
const worldSnapshotSchema = z.object({
  tick: z.number().int(),
  t: z.number().optional(),
  players: z.array(playerSnapSchema),
  foodSpawned: z.array(foodSchema).optional(),
  foodEaten: z.array(z.string()).optional(),
}) satisfies z.ZodType<WorldSnapshot>;

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
  chatId: z.string().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const okSchema = z.object({ ok: z.literal(true) });

export const gameContract = defineContract("gameService", {
  entity: gameWorldSchema,
  methods: {
    joinGame: mutation({
      input: worldScopedSchema,
      output: gameBootstrapSchema,
      describe:
        "Spawns the caller's snake in a world, puts the calling socket in the world's room, and answers the world's state with it.",
    }),
    // A query although it joins the caller to the world's chat and puts the
    // calling socket in the world's room: both joins are idempotent, so
    // fetching it again is safe, and the web app reads it as a query.
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
    getWorld: query({
      input: getWorldSchema,
      output: z
        .object({ id: z.string(), name: z.string(), chatId: z.string().nullable() })
        .nullable(),
      describe: "Reads a world by its slug (its id, name and chat), or null.",
    }),
    getMyBest: query({
      input: worldScopedSchema,
      output: z.object({ bestLength: z.number().int() }),
      describe: "The caller's best length in a world (0 before their first death).",
    }),
    getHighScores: query({
      input: highScoresSchema,
      output: z.array(highScoreEntrySchema),
      describe: "A world's best lengths, highest first (25 unless a limit is given).",
    }),
    // The admin screens: the world rows (their names and chats), for holders
    // of a service-wide Admin grant. Worlds are made by the server, never here.
    ...admin.contract({
      entity: gameWorldSchema,
      sort: ["createdAt", "name", "slug"],
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
    // Player input at about the tick rate: dropped unless the sending socket
    // is in the world's room (watchWorld or joinGame over that socket)
    // quickdraw-5.0 finding: requires: { room } is a fixed name or a function of the payload, and the handler is not told which room passed, so a game with many worlds must repeat the world id in every 20 Hz input frame; a room prefix ("world:") with the matched room on ctx is missing
    input: {
      payload: gameInputSchema,
      ratePerSecond: GAME_TICK_RATE * 1.5,
      burst: GAME_TICK_RATE * 3,
      requires: { room: GLOBAL_WORLD_ROOM },
    },
  },
  streams: {
    // Every tick of a world, volatile (a backed-up client drops frames), and
    // seeded with the latest one, so a new subscriber places every snake at
    // once. Public: signed-out visitors spectate.
    // quickdraw-5.0 finding: a seed is only the last N items pushed, so a keyframe-plus-delta stream (food spawned/eaten) cannot hand a joiner the current world (the bootstrap call still has to), and the seed of a world that stopped ticking may be minutes old with nothing saying so: a service-computed seed (or stream.setSeed) is missing
    // quickdraw-5.0 finding: stream access has no room form, so a feed cannot be limited to the sockets in a room the way a channel's requires: { room } limits input; this world is public, a private match would have to repeat its membership as an entry policy
    // quickdraw-5.0 finding: each qd:stream frame repeats {"s","stream","scope","item"} keys: 87 bytes of framing against 20 for a 4.x room event, +67 bytes per snapshot per client (+1.3 KB/s per client at 20 Hz, +29% on a two-player snapshot) where qd:event and qd:ch already use arrays
    world: {
      item: worldSnapshotSchema,
      scope: "worldId",
      seed: 1,
      volatile: true,
      access: "public",
    },
  },
  events: {
    // Sent to the world's room, reliably
    playerJoined: { payload: gamePlayerMetaSchema },
    playerLeft: { payload: z.object({ id: z.string() }) },
    death: { payload: gameDeathSchema },
    // 1Hz while the world runs
    leaderboard: { payload: z.array(leaderboardEntrySchema) },
    scoreSaved: {
      payload: z.object({
        userId: z.string(),
        bestLength: z.number().int(),
      }) satisfies z.ZodType<ScoreSavedEvent>,
    },
  },
});
