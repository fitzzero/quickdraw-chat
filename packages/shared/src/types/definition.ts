import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { definitionContract } from "../contracts/definition.js";

// ============================================================================
// Definition Service — data-driven game content (the furnace .tres insight,
// moved server-side: items/spells/tunables live in the database, edited via
// the admin UI, fetched by the server sim AND the Godot client at load).
// ============================================================================

/** Wire shape of a definition: the contract's entity (contracts/definition.ts). */
export type DefinitionDTO = EntityOf<typeof definitionContract>;

/** Well-known definition addresses used by the demo game. */
export const DEFINITION_TYPES = {
  tunables: "tunables",
} as const;

export const SNAKE_TUNABLES_KEY = "snake";
