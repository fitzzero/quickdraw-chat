import type { Definition } from "@project/db";
import type { DefinitionDTO } from "@project/shared";
import { qd } from "../../quickdraw.js";
import { definitionContract } from "@project/shared";

// quickdraw-game: the minimal 5.0 port: the public reads run on 5.0; the
// admin surface (and with it the tunables hot reload) is ported with the game
// (child 4). Its review markers stay below.

type DefinitionChangedListener = (definition: DefinitionDTO) => void;

/** The most definitions listDefinitions answers. */
const MAX_LISTED_DEFINITIONS = 500;

/** Who hears about definition edits: 4.x's DefinitionService field, as module state. */
const changedListeners: DefinitionChangedListener[] = [];

/** Subscribe to admin edits (e.g. the game sim hot-reloads tunables). */
export function onChanged(listener: DefinitionChangedListener): void {
  changedListeners.push(listener);
}

// Wire shape: dates as ISO strings (what SubscriptionDataMap advertises).
// This overrides the base hook, so subscribe payloads and emitUpdate use it
// too -- a private helper named toDTO did not, and leaked raw Prisma rows.
// quickdraw-migrate: review [projection] 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
function toDto(definition: Definition): DefinitionDTO {
  return {
    id: definition.id,
    type: definition.type,
    key: definition.key,
    data: (definition.data ?? {}) as Record<string, unknown>,
    version: definition.version,
    enabled: definition.enabled,
    updatedAt: definition.updatedAt.toISOString(),
  };
}

/** Tells the listeners about an edited definition; a listener's error never breaks the write. */
export function notifyChanged(definition: Definition): void {
  const dto = toDto(definition);
  for (const listener of changedListeners) {
    try {
      listener(dto);
    } catch {
      // Listener errors must never break admin writes
    }
  }
}

// Admin writes flow through the generic admin surface; 4.x hooked them so
// consumers (the game sim) could hot-reload.
// quickdraw-migrate: review [this] 4.x overrode adminCreate and adminUpdate to call notifyChanged(row) after each admin write, so the game sim hot-reloads tunables: give the admin kit's writes the same hook

// quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
// (4.x: list, get, create, update and delete of definitions for service Admins, "Definitions")

/**
 * DefinitionService — data-driven game content.
 *
 * The furnace lesson ("make everything resource-driven") applied to a
 * quickdraw backend: instead of baked Godot .tres resources, content lives
 * in Definition rows. Reads are Public (the Godot client fetches tunables
 * at load, pre- or post-auth); writes go through the generic admin UI, so
 * balance changes never require re-exporting the game — the server sim also
 * re-reads on change (see onChanged).
 */
export const definitionService = qd.defineService(definitionContract, {
  model: "definition",
  methods: {
    // quickdraw-migrate: review [kit] listDefinitions has the shape of the read/write kit's list, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    listDefinitions: {
      access: "public",
      handler: async ({ input, db }) => {
        const rows = await db.definition.findMany({
          where: { enabled: true, ...(input.type ? { type: input.type } : {}) },
          orderBy: [{ type: "asc" }, { key: "asc" }],
          // bounded: 5.0 refuses an unbounded read in development (unbounded-read)
          take: MAX_LISTED_DEFINITIONS,
        });
        return rows.map((row) => toDto(row));
      },
    },
    // quickdraw-migrate: review [kit] getDefinition has the shape of the read/write kit's get, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    getDefinition: {
      access: "public",
      handler: async ({ input, db }) => {
        const row = await db.definition.findUnique({
          where: { type_key: { type: input.type, key: input.key } },
        });
        return row && row.enabled ? toDto(row) : null;
      },
    },
  },
});
