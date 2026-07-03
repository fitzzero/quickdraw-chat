// ============================================================================
// Definition Service — data-driven game content (the furnace .tres insight,
// moved server-side: items/spells/tunables live in the database, edited via
// the admin UI, fetched by the server sim AND the Godot client at load).
// ============================================================================

export interface DefinitionDTO {
  id: string;
  type: string;
  key: string;
  data: Record<string, unknown>;
  version: number;
  enabled: boolean;
  updatedAt: string;
}

/** Well-known definition addresses used by the demo game. */
export const DEFINITION_TYPES = {
  tunables: "tunables",
} as const;

export const SNAKE_TUNABLES_KEY = "snake";

export interface DefinitionServiceMethods {
  listDefinitions: {
    payload: { type?: string };
    response: DefinitionDTO[];
  };
  getDefinition: {
    payload: { type: string; key: string };
    response: DefinitionDTO | null;
  };
}
