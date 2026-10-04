import type { User } from "@project/db";
import type { UserDTO, AccessLevel } from "@project/shared";
// quickdraw-migrate: review [v4-api] 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
import { type QuickdrawSocket, resolver } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";
import { qd } from "../../quickdraw.js";
import { userContract } from "@project/shared";

// Zod schemas for validation
// Admin schema - defines fields available for admin CRUD
const adminUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  image: z.string().url().optional(),
  serviceAccess: z.record(z.string(), z.enum(["Public", "Read", "Moderate", "Admin"])).optional(),
});

// Install admin CRUD methods
// quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, { displayName, hiddenFields, fieldOverrides }) in methods), then delete this; it is no longer used
const adminMethods = {
  expose: {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true,
  },
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
  schema: adminUserSchema,
  displayName: "Users",
  tableColumns: ["id", "email", "name", "createdAt"],
  // serviceAccess is exposed but handled by custom UI in admin sidebar:
  // editable via custom component, raw JSON hidden from the table
  fieldOverrides: {
    serviceAccess: {
      editable: true,
      showInTable: false,
      label: "Service Access",
    },
  },
};

// Wire shape: the public profile + protected fields (see below)
// quickdraw-migrate: review [projection] 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
function toDto(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    serviceAccess: user.serviceAccess as Record<string, AccessLevel> | null,
  };
}

// Users can access their own data
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
function checkAccess(
  userId: string,
  entryId: string,
  requiredLevel: AccessLevel,
  _socket: QuickdrawSocket,
): boolean {
  // Any authenticated user can read any profile (for profile viewing)
  if (requiredLevel === "Read") {
    return true;
  }
  // For write operations, only self-access
  return userId === entryId;
}

// Protected fields (of the wire DTO) that non-elevated subscribers won't
// receive — live emits strip these for everyone outside the :full room
// quickdraw-migrate: review [projection] protected fields: declare them in the contract's fields with the level that may read each one (fields: { email: "Admin" }), then delete this function
function getProtectedFields(): (keyof UserDTO)[] {
  return ["email", "serviceAccess"];
}

export const userService = qd.defineService(userContract, {
  model: "user",
  // quickdraw-migrate: review [access-override] 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
  access: resolver({ levelsFor: () => ({}) }),
  methods: {
    getMe: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ ctx, db }) => {
        if (!ctx.principal.userId) return null;

        const user = await db.user.findUnique({
          where: { id: ctx.principal.userId },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            serviceAccess: true,
          },
        });

        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          serviceAccess: user.serviceAccess as Record<string, AccessLevel> | null,
        };
      },
    },
    // quickdraw-migrate: review [kit] updateUser has the shape of the read/write kit's update, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    updateUser: {
      access: { service: "Read", entry: "Read", id: "id" },
      handler: async ({ input, ctx, db }) => {
        // Users can only update themselves unless they have service-level access
        if (input.id !== ctx.principal.userId && !(ctx.principal.serviceAccess ?? {}).userService) {
          throw new Error("Cannot update other users");
        }

        try {
          const updated = await db.user.update({
            where: { id: input.id },
            data: {
              name: input.data.name,
              image: input.data.image,
            },
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
            },
          });

          // Emit update to subscribers
          // quickdraw-migrate: review [emit] hand emit: 5.0 sends entity frames from tracked writes; delete this once the write goes through db
          this.emitUpdate(input.id, updated);

          return updated;
        } catch (error) {
          // User.name is unique — surface collisions as a typed result
          // (mirrors chatService.inviteByName's { error } pattern)
          if ((error as { code?: string }).code === "P2002") {
            return { error: "name_taken" as const };
          }
          throw error;
        }
      },
    },
  },
});
