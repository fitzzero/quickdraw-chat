import { admin } from "@fitzzero/quickdraw-core/server";
import { definitionContract, type DefinitionDTO } from "@project/shared";
import { qd } from "../../quickdraw.js";
import { createServiceLogger, errorMeta } from "../../utils/logger.js";

const logger = createServiceLogger("definitionService");

/** What a listener hears of an edited definition: its type, key and data. */
export type ChangedDefinition = Pick<DefinitionDTO, "type" | "key" | "data">;

type DefinitionChangedListener = (definition: ChangedDefinition) => void;

/** The most definitions listDefinitions answers. */
const MAX_LISTED_DEFINITIONS = 500;

/** Who hears about definition edits, as module state. */
const changedListeners: DefinitionChangedListener[] = [];

/** Subscribe to admin edits (e.g. the game sim hot-reloads tunables). */
export function onChanged(listener: DefinitionChangedListener): void {
  changedListeners.push(listener);
}

/**
 * Tells the listeners about an edited definition, after its write
 * committed: a listener that throws is logged and stops none of the others.
 */
export function notifyChanged(definition: ChangedDefinition): void {
  for (const listener of changedListeners) {
    try {
      listener(definition);
    } catch (error) {
      logger.warn("A definition listener failed", {
        type: definition.type,
        key: definition.key,
        error: errorMeta(error),
      });
    }
  }
}

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
    // quickdraw: hand-written because it lists only the enabled rows, to anyone signed in or not, in (type, key) order, where the read/write kit's list pages every row a policy grants
    listDefinitions: {
      access: "public",
      handler: async ({ input, db }) =>
        await db.definition.findMany({
          where: { enabled: true, ...(input.type ? { type: input.type } : {}) },
          orderBy: [{ type: "asc" }, { key: "asc" }],
          // bounded: 5.0 refuses an unbounded read in development (unbounded-read)
          take: MAX_LISTED_DEFINITIONS,
        }),
    },
    // quickdraw: hand-written because a definition is addressed by (type, key), not by id, and a disabled one reads as null, where the read/write kit's get takes an id
    getDefinition: {
      access: "public",
      handler: async ({ input, db }) => {
        const row = await db.definition.findUnique({
          where: { type_key: { type: input.type, key: input.key } },
        });
        return row?.enabled ? row : null;
      },
    },
    // Definitions edited through the generic admin screens: every row,
    // enabled or not, for holders of a service-wide Admin grant. A created or
    // updated row reaches the listeners (the running sim's tunables) once
    // the write committed, in a unit of work of its own the reply does not
    // wait for: an edit that failed or rolled back never reaches the sim.
    ...admin.handlers(definitionContract, {
      displayName: "Definitions",
      fieldOverrides: { data: { showInTable: false } },
      onCommitted: ({ method, after }) => {
        if (method !== "adminDelete" && after !== null) notifyChanged(after);
      },
    }),
  },
});
