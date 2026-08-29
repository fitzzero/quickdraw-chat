import type { Message, Prisma, PrismaClient } from "@project/db";
import type {
  MessageCollections,
  MessageDTO,
  MessageServiceMethods,
  AccessLevel,
} from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import type { CollectionSnapshotPage } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { ChatService } from "../chat/index.js";
import type { PushService } from "../push-subscription/index.js";
import {
  byIdSchema,
  cuidSchema,
  cursorPageArgs,
  requireAuth,
  sliceCursorPage,
} from "../shared/index.js";

// Zod schemas for validation
const postMessageSchema = z.object({
  chatId: cuidSchema("chat ID"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content must be 10000 characters or less"),
  role: z.enum(["user", "assistant", "system"]).optional(),
});

// Admin schema - defines fields available for admin CRUD
const adminMessageSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  content: z.string(),
  role: z.enum(["user", "assistant", "system"]),
});

export class MessageService extends BaseService<
  Message,
  // Unchecked input: services address relations by scalar FK (chatId/userId)
  Prisma.MessageUncheckedCreateInput,
  Prisma.MessageUpdateInput,
  MessageServiceMethods,
  Record<string, never>,
  MessageDTO,
  MessageCollections
> {
  private readonly prisma: PrismaClient;
  private readonly chatService: ChatService | undefined;
  private readonly pushService: PushService | undefined;

  constructor(prisma: PrismaClient, chatService?: ChatService, pushService?: PushService) {
    // Enable entry ACL - message creator gets Admin in their message's ACL
    super({ serviceName: "messageService", hasEntryACL: true });
    this.prisma = prisma;
    // Optional so the service can run standalone (e.g. MCP); when present,
    // write hooks keep chatService's `myChats` items live (lastMessageAt)
    this.chatService = chatService;
    // Optional: web-push new-message notifications to offline members
    this.pushService = pushService;
    this.setDelegate(prisma.message);

    // The live message history of one chat. Scope = chat id; membership is a
    // pure function of the row (message.chatId), so the CRUD trio emits
    // added/removed deltas with zero extra code. `ids` is deliberately never
    // returned (unbounded history — see byChatSnapshot), so reconnecting
    // clients merge without pruning and keep their paged-in history.
    this.defineCollection("byChat", {
      resolveScopeId: (message) => message.chatId,
      checkScopeAccess: (userId, chatId) => this.checkChatAccess(userId, chatId, "Read"),
      snapshot: (chatId, opts) => this.byChatSnapshot(chatId, opts),
      defaultLimit: 50,
      // toItem omitted: defaults to this service's toDto
    });

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
      schema: adminMessageSchema,
      displayName: "Messages",
      tableColumns: ["id", "chatId", "userId", "role", "createdAt"],
    });
  }

  // Wire shape: ISO createdAt + the author's public profile. The user fetch
  // makes this async — fine, toDto may return a promise.
  protected override async toDto(message: Message): Promise<MessageDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: message.userId },
      select: { id: true, name: true, image: true },
    });
    return {
      id: message.id,
      chatId: message.chatId,
      userId: message.userId,
      content: message.content,
      role: message.role,
      createdAt: message.createdAt.toISOString(),
      user: user ?? undefined,
    };
  }

  // Check chat membership for posting/listing messages
  private async checkChatAccess(
    userId: string,
    chatId: string,
    requiredLevel: AccessLevel,
  ): Promise<boolean> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { level: true },
    });

    if (!member) return false;
    return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
  }

  /**
   * First page + reconnect re-snapshot for `byChat`: newest messages first,
   * cursor = oldest message id of the page (loadMore walks into history).
   * No `ids` — chat history is unbounded, so deletion pruning is traded for
   * keeping paged-in history across reconnects.
   */
  private async byChatSnapshot(
    chatId: string,
    opts: { cursor: string | null; limit: number },
  ): Promise<CollectionSnapshotPage<MessageDTO>> {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      include: {
        user: { select: { id: true, name: true, image: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorPageArgs(opts.cursor, opts.limit),
    });

    const { page, nextCursor } = sliceCursorPage(messages, opts.limit);
    const items = page.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      userId: m.userId,
      content: m.content,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: m.user,
    }));
    const totalCount = await this.prisma.message.count({ where: { chatId } });

    return { items, nextCursor, totalCount };
  }

  // Write lifecycle hooks: keep the parent chat's `myChats` items fresh
  // (lastMessageAt drives sidebar ordering) without touching the write paths

  protected override async afterCreate(message: Message): Promise<void> {
    await this.chatService?.refreshMyChatsItem(message.chatId);
    // Fire-and-forget web push to offline chat members (no-op without VAPID)
    this.pushService?.notifyNewMessage(message);
  }

  protected override async afterDelete(message: Message): Promise<void> {
    await this.chatService?.refreshMyChatsItem(message.chatId);
  }

  private initMethods(): void {
    this.initWriteMethods();
    // Fail fast at construction if the method map and definitions drift
    this.verifyAllMethods(["postMessage", "deleteMessage"]);
  }

  private initWriteMethods(): void {
    // Post a new message
    this.defineMethod(
      "postMessage",
      "Read",
      async (payload, ctx) => {
        requireAuth(ctx);

        // Check chat access
        const hasAccess = await this.checkChatAccess(ctx.userId, payload.chatId, "Read");
        if (!hasAccess) throw new Error("Access denied to chat");

        // The CRUD trio does all the realtime work: entity event to message
        // subscribers, `byChat` `added` delta to everyone watching the chat,
        // and afterCreate refreshes the chat's `myChats` items. (Before 4.0
        // this method hand-emitted a "chat:message" room event — that whole
        // compensation layer is what collections replace.)
        const message = await this.create({
          chatId: payload.chatId,
          userId: ctx.userId,
          content: payload.content,
          role: payload.role ?? "user",
          // Creator gets Admin access in ACL for delete permissions
          acl: [{ userId: ctx.userId, level: "Admin" }],
        });

        return { id: message.id };
      },
      { schema: postMessageSchema },
    );

    // Delete a message - requires Admin in message ACL (owner) or service-level access
    // Framework handles ACL check automatically via hasEntryACL: true; the
    // CRUD trio emits the {id, deleted: true} tombstone itself
    this.defineMethod(
      "deleteMessage",
      "Admin",
      async (payload, _ctx) => {
        const deleted = await this.delete(payload.id);
        if (!deleted) throw new Error("Message not found");
        return { id: payload.id, deleted: true as const };
      },
      {
        schema: byIdSchema,
        resolveEntryId: (p) => p.id,
      },
    );
  }
}
