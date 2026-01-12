import type { Document, Prisma, PrismaClient } from "@project/db";
import type { DocumentServiceMethods, ACL, AccessLevel } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";

type ServiceMethodsRecord = Record<string, { payload: unknown; response: unknown }>;

// Admin schema - defines fields available for admin CRUD
const adminDocumentSchema = z.object({
  title: z.string(),
  content: z.string(),
  ownerId: z.string(),
});

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
export class DocumentService extends BaseService<
  Document,
  Prisma.DocumentCreateInput,
  Prisma.DocumentUpdateInput,
  DocumentServiceMethods & ServiceMethodsRecord
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "documentService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.document);
    this.initMethods();

    // Install admin CRUD methods
    this.installAdminMethods({
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
    });
  }

  /**
   * Self-access pattern: owner always has Admin access to their own documents.
   * This is called before checkEntryACL, so owner access is fast (no DB lookup).
   */
  protected override checkAccess(
    _userId: string,
    _entryId: string,
    _requiredLevel: AccessLevel,
    _socket: QuickdrawSocket
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
  protected override async checkEntryACL(
    userId: string,
    entryId: string,
    requiredLevel: AccessLevel
  ): Promise<boolean> {
    const document = await this.prisma.document.findUnique({
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

    return this.isLevelSufficient(ace.level, requiredLevel);
  }

  private initMethods(): void {
    // Create a new document
    this.defineMethod("createDocument", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      const document = await this.prisma.document.create({
        data: {
          title: payload.title,
          content: payload.content ?? "",
          ownerId: ctx.userId,
          // Owner is implicitly Admin via checkEntryACL, but we can also add them to ACL
          acl: [{ userId: ctx.userId, level: "Admin" }],
        },
        select: { id: true },
      });

      return { id: document.id };
    });

    // Get a document by ID
    this.defineMethod(
      "getDocument",
      "Read",
      async (payload, _ctx) => {
        const document = await this.prisma.document.findUnique({
          where: { id: payload.id },
        });

        if (!document) return null;

        return {
          id: document.id,
          title: document.title,
          content: document.content,
          ownerId: document.ownerId,
          acl: document.acl as ACL | null,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
        };
      },
      { resolveEntryId: (p: { id: string }) => p.id }
    );

    // Update document title or content
    this.defineMethod(
      "updateDocument",
      "Moderate",
      async (payload, _ctx) => {
        const { id, title, content } = payload as { id: string; title?: string; content?: string };
        const data: Prisma.DocumentUpdateInput = {};
        if (title !== undefined) data.title = title;
        if (content !== undefined) data.content = content;

        const document = await this.prisma.document.update({
          where: { id },
          data,
        });

        const dto = {
          id: document.id,
          title: document.title,
          content: document.content,
          ownerId: document.ownerId,
          acl: document.acl as ACL | null,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
        };

        this.emitUpdate(id, document);
        return dto;
      },
      { resolveEntryId: (p: { id: string }) => p.id }
    );

    // Delete a document
    this.defineMethod(
      "deleteDocument",
      "Admin",
      async (payload, _ctx) => {
        const { id } = payload as { id: string };
        await this.prisma.document.delete({ where: { id } });
        this.emitUpdate(id, { id, deleted: true } as Partial<Document>);
        return { id, deleted: true as const };
      },
      { resolveEntryId: (p: { id: string }) => p.id }
    );

    // List user's documents (owned or shared with them)
    this.defineMethod("listMyDocuments", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      const { page: rawPage, pageSize: rawPageSize } = payload as { page?: number; pageSize?: number };
      const page = rawPage ?? 1;
      const pageSize = Math.min(rawPageSize ?? 20, 100);

      // Find documents where user is owner OR has an ACL entry
      // Note: JSON querying varies by database. This works for PostgreSQL.
      const documents = await this.prisma.document.findMany({
        where: {
          OR: [
            { ownerId: ctx.userId },
            // PostgreSQL JSON containment: acl array contains object with userId
            {
              acl: {
                path: [],
                array_contains: [{ userId: ctx.userId }],
              },
            },
          ],
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      return documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        ownerId: doc.ownerId,
        acl: doc.acl as ACL | null,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      }));
    });

    // Share document with another user (add to ACL) - wrapped in transaction for atomicity
    this.defineMethod(
      "shareDocument",
      "Admin",
      async (payload, _ctx) => {
        const { id, userId, level } = payload as { id: string; userId: string; level: AccessLevel };
        
        await this.prisma.$transaction(async (tx) => {
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
      { resolveEntryId: (p: { id: string }) => p.id }
    );

    // Unshare document (remove from ACL) - wrapped in transaction for atomicity
    this.defineMethod(
      "unshareDocument",
      "Admin",
      async (payload, _ctx) => {
        const { id, userId } = payload as { id: string; userId: string };
        
        await this.prisma.$transaction(async (tx) => {
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
      { resolveEntryId: (p: { id: string }) => p.id }
    );
  }
}
