import type { Chat, Prisma, PrismaClient } from "@project/db";
import type {
  ChatCollections,
  ChatDTO,
  ChatListItem,
  ChatServiceMethods,
  AccessLevel,
} from "@project/shared";
import { serviceRoom } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import type { CollectionSnapshotPage } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { byIdSchema, cursorPageArgs, requireAuth, sliceCursorPage } from "../shared/index.js";

// Zod schemas for validation
const createChatSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
  members: z
    .array(
      z.object({
        userId: z.string().cuid("Invalid user ID"),
        level: z.enum(["Read", "Moderate", "Admin"]),
      }),
    )
    .optional(),
});

const updateTitleSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
});

const getChatMembersSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
});

const inviteUserSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  userId: z.string().cuid("Invalid user ID"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const removeUserSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  userId: z.string().cuid("Invalid user ID"),
});

const inviteByNameSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
  userName: z.string().min(1, "Username is required"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

// Admin schema - defines fields available for admin CRUD
const adminChatSchema = z.object({
  title: z.string(),
});

export class ChatService extends BaseService<
  Chat,
  Prisma.ChatCreateInput,
  Prisma.ChatUpdateInput,
  ChatServiceMethods,
  Record<string, never>,
  ChatDTO,
  ChatCollections
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    // hasEntryACL is true - we override checkEntryACL to use ChatMember table
    // instead of the default JSON acl field pattern (which Document uses)
    super({ serviceName: "chatService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.chat);

    // The live chat list. Scope = *user id* (scopes aren't only parent
    // entities): resolveScopeId fans one chat row out to every member's
    // scope, and the ACL is simply "you may watch your own list".
    // The CRUD trio emits deltas automatically (createChat/updateTitle);
    // membership writes and deleteChat go through the manual choke points —
    // see refreshMyChatsItem and the comments on those methods.
    this.defineCollection("myChats", {
      resolveScopeId: (chat) => this.memberUserIds(chat.id),
      checkScopeAccess: (userId, scopeId) => userId === scopeId,
      snapshot: (scopeId, opts) => this.myChatsSnapshot(scopeId, opts),
      toItem: (chat) => this.toChatListItem(chat.id),
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
      schema: adminChatSchema,
      displayName: "Chats",
      tableColumns: ["id", "title", "createdAt", "updatedAt"],
    });
  }

  // Wire shape: dates as ISO strings (what SubscriptionDataMap advertises)
  protected override toDto(chat: Chat): ChatDTO {
    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    };
  }

  // Check if user is a member of the chat with sufficient access
  // This overrides the base checkAccess since we use membership table
  protected override checkAccess(
    _userId: string,
    _chatId: string,
    _requiredLevel: AccessLevel,
    _socket: unknown,
  ): boolean {
    // We need async check, so return false here and do it in checkEntryACL
    return false;
  }

  // Check access via ChatMember table (called after checkAccess returns false)
  protected override async checkEntryACL(
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

  // ===========================================================================
  // myChats collection plumbing
  // ===========================================================================

  /** All member user ids of a chat — the fan-out scopes of `myChats`. */
  private async memberUserIds(chatId: string): Promise<string[]> {
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** Build the `myChats` item for one chat (member count + last activity). */
  private async toChatListItem(chatId: string): Promise<ChatListItem> {
    const chat = await this.prisma.chat.findUniqueOrThrow({
      where: { id: chatId },
      include: {
        _count: { select: { members: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    return {
      id: chat.id,
      title: chat.title,
      memberCount: chat._count.members,
      lastMessageAt: chat.messages[0]?.createdAt.toISOString() ?? null,
      createdAt: chat.createdAt.toISOString(),
    };
  }

  /**
   * First page + reconnect re-snapshot for `myChats`. Server-ordered by
   * membership recency; cursor = membership id. Cursor-less calls include
   * the full membership `ids` so reconnecting clients can prune chats
   * deleted (or left) while they were offline.
   */
  private async myChatsSnapshot(
    userId: string,
    opts: { cursor: string | null; limit: number },
  ): Promise<CollectionSnapshotPage<ChatListItem>> {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            _count: { select: { members: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // Cursor = membership id (unique within the ordering)
      ...cursorPageArgs(opts.cursor, opts.limit),
    });

    const { page, nextCursor } = sliceCursorPage(memberships, opts.limit);
    const items = page.map((m) => ({
      id: m.chat.id,
      title: m.chat.title,
      memberCount: m.chat._count.members,
      lastMessageAt: m.chat.messages[0]?.createdAt.toISOString() ?? null,
      createdAt: m.chat.createdAt.toISOString(),
    }));

    const totalCount = await this.prisma.chatMember.count({ where: { userId } });

    if (opts.cursor !== null) {
      return { items, nextCursor, totalCount };
    }

    const ids = await this.prisma.chatMember.findMany({
      where: { userId },
      select: { chatId: true },
    });
    return { items, nextCursor, totalCount, ids: ids.map((m) => m.chatId) };
  }

  /**
   * Recompute a chat's `myChats` item and upsert it into every member's
   * scope. The choke point for writes the CRUD trio can't see: membership
   * changes (ChatMember rows aren't Chat rows) and message activity
   * (messageService calls this from its write hooks to keep
   * `lastMessageAt`/ordering live).
   */
  public async refreshMyChatsItem(chatId: string): Promise<void> {
    try {
      const [item, memberIds] = await Promise.all([
        this.toChatListItem(chatId),
        this.memberUserIds(chatId),
      ]);
      for (const userId of memberIds) {
        this.emitCollectionUpsert("myChats", userId, item);
      }
    } catch (error) {
      // Emission is best-effort: the write already committed
      this.logger.warn(`myChats refresh failed for chat ${chatId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Helper to fetch members with user details
  private async fetchChatMembers(chatId: string): Promise<
    {
      id: string;
      userId: string;
      level: AccessLevel;
      user: { id: string; name: string | null; image: string | null };
    }[]
  > {
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: {
        user: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      level: m.level as AccessLevel,
      user: {
        id: m.user.id,
        name: m.user.name,
        image: m.user.image,
      },
    }));
  }

  // Helper to emit member updates to all chat subscribers
  private async emitMemberUpdate(chatId: string): Promise<void> {
    const members = await this.fetchChatMembers(chatId);
    this.emitToRoom(serviceRoom("chatService", chatId), "chat:memberUpdate", { members });
  }

  private initMethods(): void {
    this.initCrudMethods();
    this.initQueryMethods();
    this.initInviteMethods();
    this.initRemovalMethods();
    // Fail fast at construction if the method map and definitions drift
    this.verifyAllMethods([
      "createChat",
      "updateTitle",
      "deleteChat",
      "getChatMembers",
      "inviteUser",
      "inviteByName",
      "removeUser",
      "leaveChat",
    ]);
  }

  private initCrudMethods(): void {
    // Create a new chat - demonstrates Zod validation.
    // Going through the CRUD trio makes the framework do the realtime work:
    // it emits the entity event and fans a `myChats` `added` delta out to
    // every initial member's scope (resolveScopeId sees the nested-created
    // memberships — the write is atomic and committed by then).
    this.defineMethod(
      "createChat",
      "Read",
      async (payload, ctx) => {
        requireAuth(ctx);

        const chat = await this.create({
          title: payload.title,
          members: {
            create: [
              { userId: ctx.userId, level: "Admin" },
              ...(payload.members?.map((m) => ({
                userId: m.userId,
                level: m.level,
              })) ?? []),
            ],
          },
        });

        return { id: chat.id };
      },
      { schema: createChatSchema },
    );

    // Update chat title — the trio emits the entity update and a `myChats`
    // `updated` delta to every member's scope automatically
    this.defineMethod(
      "updateTitle",
      "Moderate",
      async (payload, _ctx) => {
        const updated = await this.update(payload.id, { title: payload.title });
        if (!updated) return null;
        return { id: updated.id, title: updated.title };
      },
      {
        schema: updateTitleSchema,
        resolveEntryId: (p) => p.id,
      },
    );

    // Delete chat — the trio emits the {id, deleted: true} tombstone, but
    // the `myChats` removals must be manual: memberships cascade-delete with
    // the chat, so by the time the framework resolves the row's scopes the
    // membership table is already empty. Capture the scopes first.
    this.defineMethod(
      "deleteChat",
      "Admin",
      async (payload, _ctx) => {
        const memberIds = await this.memberUserIds(payload.id);
        const deleted = await this.delete(payload.id);
        if (!deleted) throw new Error("Chat not found");

        for (const userId of memberIds) {
          this.emitCollectionRemove("myChats", userId, payload.id);
        }
        return { id: payload.id, deleted: true as const };
      },
      {
        schema: byIdSchema,
        resolveEntryId: (p) => p.id,
      },
    );
  }

  private initQueryMethods(): void {
    // Get chat members with user details. Genuinely query-shaped (a joined
    // roster, not rows of this service) — clients pair it with
    // invalidateOn: ["chat:memberUpdate"] instead of a collection.
    this.defineMethod(
      "getChatMembers",
      "Read",
      async (payload, _ctx) => {
        return await this.fetchChatMembers(payload.chatId);
      },
      {
        schema: getChatMembersSchema,
        resolveEntryId: (p) => p.chatId,
      },
    );
  }

  // Membership writes touch the ChatMember table, not the Chat row, so the
  // CRUD trio can't see them — collection emission here goes through the
  // manual choke points: an upsert into the affected user's scope (and every
  // other member's, since memberCount changed), a remove for users who lost
  // the chat.

  private initInviteMethods(): void {
    // Invite user to chat by userId
    this.defineMethod(
      "inviteUser",
      "Moderate",
      async (payload, _ctx) => {
        // Add or update membership (single atomic operation)
        await this.prisma.chatMember.upsert({
          where: {
            chatId_userId: { chatId: payload.id, userId: payload.userId },
          },
          update: { level: payload.level },
          create: {
            chatId: payload.id,
            userId: payload.userId,
            level: payload.level,
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);
        // The invited user's myChats gains the chat; everyone's memberCount moves
        await this.refreshMyChatsItem(payload.id);

        return { id: payload.id };
      },
      {
        schema: inviteUserSchema,
        resolveEntryId: (p) => p.id,
      },
    );

    // Invite user to chat by username
    this.defineMethod(
      "inviteByName",
      "Moderate",
      async (payload, _ctx) => {
        // Look up user by name
        const user = await this.prisma.user.findUnique({
          where: { name: payload.userName },
          select: { id: true },
        });

        if (!user) {
          return { error: "user_not_found" as const };
        }

        // Add or update membership
        await this.prisma.chatMember.upsert({
          where: {
            chatId_userId: { chatId: payload.chatId, userId: user.id },
          },
          update: { level: payload.level },
          create: {
            chatId: payload.chatId,
            userId: user.id,
            level: payload.level,
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.chatId);
        // The invited user's myChats gains the chat; everyone's memberCount moves
        await this.refreshMyChatsItem(payload.chatId);

        return { id: payload.chatId };
      },
      {
        schema: inviteByNameSchema,
        resolveEntryId: (p) => p.chatId,
      },
    );
  }

  private initRemovalMethods(): void {
    // Remove user from chat
    this.defineMethod(
      "removeUser",
      "Moderate",
      async (payload, _ctx) => {
        await this.prisma.chatMember.delete({
          where: {
            chatId_userId: { chatId: payload.id, userId: payload.userId },
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);
        // The chat vanishes from the removed user's list; counts move for the rest
        this.emitCollectionRemove("myChats", payload.userId, payload.id);
        await this.refreshMyChatsItem(payload.id);

        return { id: payload.id };
      },
      {
        schema: removeUserSchema,
        resolveEntryId: (p) => p.id,
      },
    );

    // Leave chat
    this.defineMethod(
      "leaveChat",
      "Read",
      async (payload, ctx) => {
        requireAuth(ctx);

        await this.prisma.chatMember.delete({
          where: { chatId_userId: { chatId: payload.id, userId: ctx.userId } },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);
        // The chat vanishes from the leaver's list; counts move for the rest
        this.emitCollectionRemove("myChats", ctx.userId, payload.id);
        await this.refreshMyChatsItem(payload.id);

        return { id: payload.id };
      },
      {
        schema: byIdSchema,
        resolveEntryId: (p) => p.id,
      },
    );
  }
}
