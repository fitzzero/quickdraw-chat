// The contract of definitionService: data-driven game content, read by
// anyone (enabled rows) and edited through the admin kit.

import { admin, defineContract, listOf, nullable, query } from "@fitzzero/quickdraw-core";
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
    // The admin screens: every definition, enabled or not, for holders of a
    // service-wide Admin grant (balance changes without re-exporting the game)
    ...admin.contract({
      entity: definitionSchema,
      filter: ["type", "enabled"],
      sort: ["type", "key", "version", "updatedAt"],
    }),
  },
});
