import type { Definition, Prisma, PrismaClient } from "@project/db";
import type { DefinitionDTO, DefinitionServiceMethods } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";

// Zod schemas for validation
const listDefinitionsSchema = z.object({
  type: z.string().min(1).max(64).optional(),
});

const getDefinitionSchema = z.object({
  type: z.string().min(1).max(64),
  key: z.string().min(1).max(64),
});

// Admin schema - defines fields available for admin CRUD
const adminDefinitionSchema = z.object({
  type: z.string(),
  key: z.string(),
  data: z.record(z.string(), z.unknown()),
  version: z.number(),
  enabled: z.boolean(),
});

type DefinitionChangedListener = (definition: DefinitionDTO) => void;

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
export class DefinitionService extends BaseService<
  Definition,
  Prisma.DefinitionCreateInput,
  Prisma.DefinitionUpdateInput,
  DefinitionServiceMethods
> {
  private readonly prisma: PrismaClient;
  private readonly changedListeners: DefinitionChangedListener[] = [];

  constructor(prisma: PrismaClient) {
    super({ serviceName: "definitionService", hasEntryACL: false });
    this.prisma = prisma;
    this.setDelegate(prisma.definition);
    this.initMethods();
    this.installAdmin();
  }

  /** Subscribe to admin edits (e.g. the game sim hot-reloads tunables). */
  public onChanged(listener: DefinitionChangedListener): void {
    this.changedListeners.push(listener);
  }

  private notifyChanged(definition: Definition): void {
    const dto = this.toDTO(definition);
    for (const listener of this.changedListeners) {
      try {
        listener(dto);
      } catch {
        // Listener errors must never break admin writes
      }
    }
  }

  private toDTO(definition: Definition): DefinitionDTO {
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

  private initMethods(): void {
    // Public: game clients fetch content at load, before auth completes.
    // Definitions are game content — never store secrets in them.
    this.defineMethod(
      "listDefinitions",
      "Public",
      async (payload) => {
        const rows = await this.prisma.definition.findMany({
          where: { enabled: true, ...(payload.type ? { type: payload.type } : {}) },
          orderBy: [{ type: "asc" }, { key: "asc" }],
        });
        return rows.map((row) => this.toDTO(row));
      },
      { schema: listDefinitionsSchema },
    );

    this.defineMethod(
      "getDefinition",
      "Public",
      async (payload) => {
        const row = await this.prisma.definition.findUnique({
          where: { type_key: { type: payload.type, key: payload.key } },
        });
        return row && row.enabled ? this.toDTO(row) : null;
      },
      { schema: getDefinitionSchema },
    );
  }

  // Admin writes flow through the generic admin surface; hook them so
  // consumers (the game sim) can hot-reload.
  protected override async adminCreate(data: Prisma.DefinitionCreateInput): Promise<Definition> {
    const created = await super.adminCreate(data);
    this.notifyChanged(created);
    return created;
  }

  protected override async adminUpdate(
    id: string,
    data: Prisma.DefinitionUpdateInput,
  ): Promise<Definition | null> {
    const updated = await super.adminUpdate(id, data);
    if (updated) this.notifyChanged(updated);
    return updated;
  }

  private installAdmin(): void {
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
}
