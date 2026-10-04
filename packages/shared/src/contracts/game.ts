// The contract of gameService, written by @fitzzero/quickdraw-codemod from
// GameServiceMethods and the defineMethod calls of GameService
// (apps/api/src/services/game/index.ts), then completed by hand: real output
// schemas and the entity. Each schema below satisfies the wire type of the same
// shape in ../types/game.ts, which documents the protocol for the Godot client.
// The input channel and the world's events are still the 4.x ones; they move
// to this contract with the game service.

import { defineContract, mutation, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type {
  FoodDTO,
  GameBootstrap,
  GamePlayerMeta,
  HighScoreEntry,
  PlayerSnap,
  WorldBootstrap,
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
      describe: "Spawns the caller's snake in a world and answers the world's state with it.",
    }),
    // A query although it joins the caller to the world's chat (and, signed
    // out, to the world's room): both joins are idempotent, so fetching it
    // again is safe, and the web app reads it as a query.
    watchWorld: query({
      input: worldScopedSchema,
      output: worldBootstrapSchema,
      describe: "Answers a world's state without spawning, for spectating.",
    }),
    respawn: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe: "Respawns the caller's snake after it died.",
    }),
    leaveGame: mutation({
      input: worldScopedSchema,
      output: okSchema,
      describe: "Takes the caller's snake out of the world.",
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
  },
});
