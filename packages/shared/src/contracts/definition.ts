// The contract of definitionService, written by @fitzzero/quickdraw-codemod from
// DefinitionServiceMethods and the defineMethod calls of DefinitionService
// (apps/api/src/services/definition/index.ts).
// Every marker below says what to check.

import { defineContract, listOf, nullable, query, todoSchema } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { DefinitionDTO } from "../types/definition.js";

const listDefinitionsSchema = z.object({
  type: z.string().min(1).max(64).optional(),
});

const getDefinitionSchema = z.object({
  type: z.string().min(1).max(64),
  key: z.string().min(1).max(64),
});

export const definitionContract = defineContract("definitionService", {
  // quickdraw-migrate: review [contract] the entity is the 4.x DTO DefinitionDTO: give it a real schema. Its keys are the fields subscribers receive, read from model "definition": drop any that is not a column, or give it a projection select and map
  entity: todoSchema<DefinitionDTO>({
    keys: ["id", "type", "key", "data", "version", "enabled", "updatedAt"],
  }),
  methods: {
    // quickdraw-migrate: review [contract] query, chosen from its name
    listDefinitions: query({ input: listDefinitionsSchema, output: listOf("entity") }),
    // quickdraw-migrate: review [contract] query, chosen from its name
    getDefinition: query({ input: getDefinitionSchema, output: nullable("entity") }),
  },
});
