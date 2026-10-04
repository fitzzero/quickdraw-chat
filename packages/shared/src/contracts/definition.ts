// The contract of definitionService, written by @fitzzero/quickdraw-codemod from
// DefinitionServiceMethods and the defineMethod calls of DefinitionService
// (apps/api/src/services/definition/index.ts), then completed by hand: the
// entity.

import { defineContract, listOf, nullable, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { isoDateSchema } from "./helpers.js";

const listDefinitionsSchema = z.object({
  type: z.string().min(1).max(64).optional(),
});

const getDefinitionSchema = z.object({
  type: z.string().min(1).max(64),
  key: z.string().min(1).max(64),
});

/**
 * One piece of data-driven game content (tunables, items, spells), addressed
 * by `type` and `key`. Content is public: never store a secret in `data`.
 */
export const definitionSchema = z.object({
  id: z.string(),
  type: z.string(),
  key: z.string(),
  data: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  enabled: z.boolean(),
  updatedAt: isoDateSchema,
});

export const definitionContract = defineContract("definitionService", {
  entity: definitionSchema,
  methods: {
    listDefinitions: query({
      input: listDefinitionsSchema,
      output: listOf("entity"),
      describe: "Lists the enabled definitions, of one type when given, by type and key.",
    }),
    getDefinition: query({
      input: getDefinitionSchema,
      output: nullable("entity"),
      describe: "Reads one enabled definition by type and key, or null.",
    }),
  },
});
