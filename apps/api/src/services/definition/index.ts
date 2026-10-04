import type { Definition } from "@project/db";
import { admin, type KitHandler, type KitHandlerArgs } from "@fitzzero/quickdraw-core/server";
import { definitionContract } from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";

type Db = typeof appDb;

type DefinitionChangedListener = (definition: Definition) => void;

/** The most definitions listDefinitions answers. */
const MAX_LISTED_DEFINITIONS = 500;

/** Who hears about definition edits, as module state. */
const changedListeners: DefinitionChangedListener[] = [];

/** Subscribe to admin edits (e.g. the game sim hot-reloads tunables). */
export function onChanged(listener: DefinitionChangedListener): void {
  changedListeners.push(listener);
}

/** Tells the listeners about an edited definition; a listener's error never breaks the write. */
export function notifyChanged(definition: Definition): void {
  for (const listener of changedListeners) {
    try {
      listener(definition);
    } catch {
      // Listener errors must never break admin writes
    }
  }
}

/** The id of the row an admin write answered. */
function writtenId(row: unknown): string | undefined {
  const id: unknown = typeof row === "object" && row !== null ? Reflect.get(row, "id") : undefined;
  return typeof id === "string" ? id : undefined;
}

/**
 * An admin kit write that tells the listeners about the row it wrote, read
 * back once the write is done (wraps the kit's adminCreate and adminUpdate).
 */
// quickdraw-5.0 finding: the admin kit has no write hook (the sharing kit has onChange), so reacting to an admin edit means wrapping the kit's handler by hand, and KitHandler returns Promise<never>, so the wrapper reads the written row's id through unknown and returns its own cast
function announcing(handler: KitHandler): KitHandler {
  const wrapped = async (args: KitHandlerArgs): Promise<unknown> => {
    const row: unknown = await handler(args);
    const id = writtenId(row);
    const db = args.db as Db;
    const written = id === undefined ? null : await db.definition.findUnique({ where: { id } });
    if (written !== null) notifyChanged(written);
    return row;
  };
  return wrapped as KitHandler;
}

// Definitions edited through the generic admin screens: every row, enabled
// or not, for holders of a service-wide Admin grant
const definitionAdmin = admin.handlers(definitionContract, {
  displayName: "Definitions",
  fieldOverrides: { data: { showInTable: false } },
});

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
    ...definitionAdmin,
    adminCreate: {
      ...definitionAdmin.adminCreate,
      handler: announcing(definitionAdmin.adminCreate.handler),
    },
    adminUpdate: {
      ...definitionAdmin.adminUpdate,
      handler: announcing(definitionAdmin.adminUpdate.handler),
    },
  },
});
