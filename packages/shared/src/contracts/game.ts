// The contract of gameService, written by @fitzzero/quickdraw-codemod from
// GameServiceMethods and the defineMethod calls of GameService
// (apps/api/src/services/game/index.ts).
// Every marker below says what to check.

import { defineContract, mutation, query, todoSchema } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { GameBootstrap, HighScoreEntry, WorldBootstrap } from "../types/game.js";

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

export const gameContract = defineContract("gameService", {
  // quickdraw-migrate: review [contract] the 4.x DTO (GameWorld) is not a type of the shared package: describe the entity, whose keys are the fields subscribers receive
  entity: todoSchema<{ id: string }>({ keys: ["id"] }),
  methods: {
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    joinGame: mutation({ input: worldScopedSchema, output: todoSchema<GameBootstrap>() }),
    // quickdraw-migrate: review [contract] query, since the web app reads it with useServiceQuery (its name reads as a mutation); output: todoSchema of the 4.x response type
    watchWorld: query({ input: worldScopedSchema, output: todoSchema<WorldBootstrap>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    respawn: mutation({ input: worldScopedSchema, output: todoSchema<{ ok: true }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    leaveGame: mutation({ input: worldScopedSchema, output: todoSchema<{ ok: true }>() }),
    // quickdraw-migrate: review [contract] query, chosen from its name; output: todoSchema of the 4.x response type
    getWorld: query({
      input: getWorldSchema,
      output: todoSchema<{ id: string; name: string; chatId: string | null } | null>(),
    }),
    // quickdraw-migrate: review [contract] query, chosen from its name; output: todoSchema of the 4.x response type
    getMyBest: query({ input: worldScopedSchema, output: todoSchema<{ bestLength: number }>() }),
    // quickdraw-migrate: review [contract] query, chosen from its name; output: todoSchema of the 4.x response type
    getHighScores: query({ input: highScoresSchema, output: todoSchema<HighScoreEntry[]>() }),
  },
});
