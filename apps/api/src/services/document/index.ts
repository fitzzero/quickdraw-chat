import type { Document, Prisma } from "@project/db";
import type { DocumentDTO, ACL, AccessLevel } from "@project/shared";
// quickdraw-migrate: review [v4-api] 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
import { type QuickdrawSocket, resolver } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";
import { parsePagination } from "../shared/index.js";
import { qd } from "../../quickdraw.js";
import { documentContract } from "@project/shared";
import { db } from "../../db.js";

// Admin schema - defines fields available for admin CRUD
const adminDocumentSchema = z.object({
  title: z.string(),
  content: z.string(),
  ownerId: z.string(),
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
  schema: adminDocumentSchema,
  displayName: "Documents",
  tableColumns: ["id", "title", "ownerId", "createdAt", "updatedAt"],
};

// Wire shape: ISO dates + typed ACL (what SubscriptionDataMap advertises)
// quickdraw-migrate: review [projection] 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
function toDto(document: Document): DocumentDTO {
  return {
    id: document.id,
    title: document.title,
    content: document.content,
    ownerId: document.ownerId,
    acl: document.acl as ACL | null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/**
 * Self-access pattern: owner always has Admin access to their own documents.
 * This is called before checkEntryACL, so owner access is fast (no DB lookup).
 */
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
function checkAccess(
  _userId: string,
  _entryId: string,
  _requiredLevel: AccessLevel,
  _socket: QuickdrawSocket,
): boolean {
  // We need to check ownership, but we don't have the document loaded yet.
  // Return false here and handle owner check in checkEntryACL.
  // Alternatively, we could cache document->owner mappings.
  return false;
}

/**
 * Entry-level ACL check using the JSON acl field.
 * Also checks ownership for self-access pattern.
 */
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
async function checkEntryACL(
  userId: string,
  entryId: string,
  requiredLevel: AccessLevel,
): Promise<boolean> {
  const document = await db.document.findUnique({
    where: { id: entryId },
    select: { ownerId: true, acl: true },
  });

  if (!document) return false;

  // Owner always has Admin access
  if (document.ownerId === userId) {
    return true;
  }

  // Check ACL for collaborators
  const acl = document.acl as ACL | null;
  if (!acl || !Array.isArray(acl)) return false;

  const ace = acl.find((a) => a.userId === userId);
  if (!ace) return false;

  // quickdraw-migrate: review [access] this.isLevelSufficient: compare levels in a policy or a custom(fn) form (Public < Read < Moderate < Admin)
  return this.isLevelSufficient(ace.level, requiredLevel);
}

/**
 * DocumentService demonstrates the simpler JSON ACL pattern.
 *
 * Unlike ChatService which uses a separate membership table (ChatMember),
 * DocumentService uses the built-in JSON ACL field directly on the Document model.
 *
 * This is ideal for:
 * - Simple ownership models (owner + optional collaborators)
 * - When you don't need to query "all documents user X can access" efficiently
 * - Minimal schema complexity
 *
 * Access is granted if:
 * 1. User has service-level access (socket.serviceAccess.documentService >= required)
 * 2. User is the owner (self-access pattern via checkAccess override)
 * 3. User has an ACE in the document's acl field (default checkEntryACL)
 */
export const documentService = qd.defineService(documentContract, {
  model: "document",
  // quickdraw-migrate: review [access-override] 4.x decided row access in checkAccess and checkEntryACL (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
  access: resolver({ levelsFor: () => ({}) }),
  methods: {
    // quickdraw-migrate: review [kit] createDocument has the shape of the read/write kit's create, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    createDocument: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        const document = await db.document.create({
          data: {
            title: input.title,
            content: input.content ?? "",
            ownerId: ctx.principal.userId,
            // Owner is implicitly Admin via checkEntryACL, but we can also add them to ACL
            acl: [{ userId: ctx.principal.userId, level: "Admin" }],
          },
          select: { id: true },
        });

        return { id: document.id };
      },
    },
    // quickdraw-migrate: review [kit] getDocument has the shape of the read/write kit's get, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    getDocument: {
      access: { service: "Read", entry: "Read", id: "id" },
      handler: async ({ input, db }) => {
        const document = await db.document.findUnique({
          where: { id: input.id },
        });

        if (!document) return null;
        return toDto(document);
      },
    },
    // quickdraw-migrate: review [kit] updateDocument has the shape of the read/write kit's update, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    updateDocument: {
      access: { service: "Moderate", entry: "Moderate", id: "id" },
      handler: async ({ input }) => {
        const { id, title, content } = input as { id: string; title?: string; content?: string };
        const data: Prisma.DocumentUpdateInput = {};
        if (title !== undefined) data.title = title;
        if (content !== undefined) data.content = content;

        // quickdraw-migrate: review [write] 4.x CRUD helper this.update: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.document.update(...) instead (frames follow the tracked write; hooks do not run; 4.x returned null for a missing row where db.update throws NOT_FOUND)
        const document = await this.update(id, data);
        return document ? toDto(document) : null;
      },
    },
    // quickdraw-migrate: review [kit] deleteDocument has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    deleteDocument: {
      access: { service: "Admin", entry: "Admin", id: "id" },
      handler: async ({ input }) => {
        const { id } = input as { id: string };
        // quickdraw-migrate: review [write] 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.document.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)
        const deleted = await this.delete(id);
        if (!deleted) throw new Error("Document not found");
        return { id, deleted: true as const };
      },
    },
    listMyDocuments: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        const { skip, take } = parsePagination(input);

        // Find documents where user is owner OR has an ACL entry
        // Note: JSON querying varies by database. This works for PostgreSQL.
        const documents = await db.document.findMany({
          where: {
            OR: [
              { ownerId: ctx.principal.userId },
              // PostgreSQL JSON containment: acl array contains object with userId
              {
                acl: {
                  path: [],
                  array_contains: [{ userId: ctx.principal.userId }],
                },
              },
            ],
          },
          orderBy: { updatedAt: "desc" },
          skip,
          take,
        });

        return documents.map((doc) => toDto(doc));
      },
    },
    shareDocument: {
      access: { service: "Admin", entry: "Admin", id: "id" },
      handler: async ({ input, db }) => {
        const { id, userId, level } = input as { id: string; userId: string; level: AccessLevel };

        await db.$transaction(async (tx) => {
          const document = await tx.document.findUnique({
            where: { id },
            select: { acl: true },
          });

          if (!document) throw new Error("Document not found");

          const currentAcl = (document.acl as unknown as ACL) ?? [];
          // Remove existing entry for this user if present
          const newAcl = currentAcl.filter((a) => a.userId !== userId);
          // Add new entry
          newAcl.push({ userId, level });

          await tx.document.update({
            where: { id },
            data: { acl: newAcl as unknown as Prisma.InputJsonValue },
          });
        });

        return { id };
      },
    },
    unshareDocument: {
      access: { service: "Admin", entry: "Admin", id: "id" },
      handler: async ({ input, db }) => {
        const { id, userId } = input as { id: string; userId: string };

        await db.$transaction(async (tx) => {
          const document = await tx.document.findUnique({
            where: { id },
            select: { acl: true },
          });

          if (!document) throw new Error("Document not found");

          const currentAcl = (document.acl as unknown as ACL) ?? [];
          const newAcl = currentAcl.filter((a) => a.userId !== userId);

          await tx.document.update({
            where: { id },
            data: { acl: newAcl as unknown as Prisma.InputJsonValue },
          });
        });

        return { id };
      },
    },
  },
});
