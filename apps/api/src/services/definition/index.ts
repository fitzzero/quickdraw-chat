import type { Definition } from "@project/db";
import type { DefinitionDTO } from "@project/shared";
import { z } from "zod";
import { qd } from "../../quickdraw.js";
import { definitionContract } from "@project/shared";

// Zod schemas for validation
// Admin schema - defines fields available for admin CRUD
const adminDefinitionSchema = z.object({
  type: z.string(),
  key: z.string(),
  data: z.record(z.string(), z.unknown()),
  version: z.number(),
  enabled: z.boolean(),
});

type DefinitionChangedListener = (definition: DefinitionDTO) => void;

// quickdraw-migrate: review [this] 4.x constructor code of DefinitionService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
// quickdraw-5.0 finding: the codemod dropped the field changedListeners (initialized to []) that onChanged and notifyChanged read; only those uses are marked
function setUpDefinitionService(): void {
  installAdmin();
}

/** Subscribe to admin edits (e.g. the game sim hot-reloads tunables). */
export function onChanged(listener: DefinitionChangedListener): void {
  // quickdraw-migrate: review [this] this.changedListeners was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  this.changedListeners.push(listener);
}

function notifyChanged(definition: Definition): void {
  const dto = toDto(definition);
  // quickdraw-migrate: review [this] this.changedListeners was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  for (const listener of this.changedListeners) {
    try {
      listener(dto);
    } catch {
      // Listener errors must never break admin writes
    }
  }
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

// Admin writes flow through the generic admin surface; 4.x hooked them so
// consumers (the game sim) could hot-reload.
// quickdraw-migrate: review [this] 4.x overrode adminCreate and adminUpdate to call notifyChanged(row) after each admin write, so the game sim hot-reloads tunables: give the admin kit's writes the same hook
// quickdraw-5.0 finding: the codemod kept those two overrides as module functions calling super.adminCreate(data) and super.adminUpdate(id, data), which does not parse (oxlint stops at the syntax error, and no baseline can hold one); they are removed, and the marker above keeps their item

function installAdmin(): void {
  // quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
  this.installAdminMethods({
    expose: { list: true, get: true, create: true, update: true, delete: true },
    access: {
      list: "Admin",
      get: "Admin",
      create: "Admin",
      update: "Admin",
      delete: "Admin",
      setEntryACL: "Admin",
      getSubscribers: "Admin",
      reemit: "Admin",
      unsubscribeAll: "Admin",
    },
    schema: adminDefinitionSchema,
    displayName: "Definitions",
    tableColumns: ["id", "type", "key", "version", "enabled", "updatedAt"],
  });
}

/**
 * DefinitionService — data-driven game content.
 *
 * The furnace lesson ("make everything resource-driven") applied to a
 * quickdraw backend: instead of baked Godot .tres resources, content lives
 * in Definition rows. Reads are Public (the Godot client fetches tunables
 * at load, pre- or post-auth); writes go through the generic admin UI
 * (installAdminMethods), so balance changes never require re-exporting
 * the game — the server sim also re-reads on change (see onChanged).
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
