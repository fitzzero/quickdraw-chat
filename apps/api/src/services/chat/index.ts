import type { Chat } from "@project/db";
import type { ChatDTO, ChatListItem, AccessLevel } from "@project/shared";
import { serviceRoom, chatContract } from "@project/shared";
import { resolver } from "@fitzzero/quickdraw-core/server";
// quickdraw-migrate: review [v4-api] 4.x API CollectionSnapshotPage (removed): lint's no-v4-api names each replacement
import type { CollectionSnapshotPage } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { cursorPageArgs, sliceCursorPage } from "../shared/index.js";
import { qd } from "../../quickdraw.js";
import { db } from "../../db.js";

// Zod schemas for validation
// Admin schema - defines fields available for admin CRUD
const adminChatSchema = z.object({
  title: z.string(),
});

// The live chat list. Scope = *user id* (scopes aren't only parent
// entities): resolveScopeId fans one chat row out to every member's
// scope, and the ACL is simply "you may watch your own list".
// The CRUD trio emits deltas automatically (createChat/updateTitle);
// membership writes and deleteChat go through the manual choke points —
// see refreshMyChatsItem and the comments on those methods.
// quickdraw-migrate: review [collection] 4.x collection "myChats": declare it in the contract's collections (scope, item, order) and anchor it in defineService's collections, then delete this; it is no longer used
const myChatsCollection = {
  resolveScopeId: (chat) => memberUserIds(chat.id),
  checkScopeAccess: (userId, scopeId) => userId === scopeId,
  snapshot: (scopeId, opts) => myChatsSnapshot(scopeId, opts),
  toItem: (chat) => toChatListItem(chat.id),
};

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
  schema: adminChatSchema,
  displayName: "Chats",
  tableColumns: ["id", "title", "createdAt", "updatedAt"],
};

// Wire shape: dates as ISO strings (what SubscriptionDataMap advertises)
// quickdraw-migrate: review [projection] 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
function toDto(chat: Chat): ChatDTO {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

// Check if user is a member of the chat with sufficient access
// This overrides the base checkAccess since we use membership table
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
function checkAccess(
  _userId: string,
  _chatId: string,
  _requiredLevel: AccessLevel,
  _socket: unknown,
): boolean {
  // We need async check, so return false here and do it in checkEntryACL
  return false;
}

// Check access via ChatMember table (called after checkAccess returns false)
// quickdraw-migrate: review [access-override] 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
async function checkEntryACL(
  userId: string,
  chatId: string,
  requiredLevel: AccessLevel,
): Promise<boolean> {
  const member = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { level: true },
  });

  if (!member) return false;
  // quickdraw-migrate: review [access] this.isLevelSufficient: compare levels in a policy or a custom(fn) form (Public < Read < Moderate < Admin)
  return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
}

// ===========================================================================
// myChats collection plumbing
// ===========================================================================
/** All member user ids of a chat — the fan-out scopes of `myChats`. */
async function memberUserIds(chatId: string): Promise<string[]> {
  const members = await db.chatMember.findMany({
    where: { chatId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** Build the `myChats` item for one chat (member count + last activity). */
async function toChatListItem(chatId: string): Promise<ChatListItem> {
  const chat = await db.chat.findUniqueOrThrow({
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
async function myChatsSnapshot(
  userId: string,
  opts: { cursor: string | null; limit: number },
): Promise<CollectionSnapshotPage<ChatListItem>> {
  const memberships = await db.chatMember.findMany({
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

  const totalCount = await db.chatMember.count({ where: { userId } });

  if (opts.cursor !== null) {
    return { items, nextCursor, totalCount };
  }

  const ids = await db.chatMember.findMany({
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
export async function refreshMyChatsItem(chatId: string): Promise<void> {
  try {
    const [item, memberIds] = await Promise.all([toChatListItem(chatId), memberUserIds(chatId)]);
    for (const userId of memberIds) {
      // quickdraw-migrate: review [emit] hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
      this.emitCollectionUpsert("myChats", userId, item);
    }
  } catch (error) {
    // Emission is best-effort: the write already committed
    // quickdraw-migrate: review [this] the 4.x service logger: take a Logger argument, or log from the handler that calls this with ctx.log
    this.logger.warn(`myChats refresh failed for chat ${chatId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Helper to fetch members with user details
async function fetchChatMembers(chatId: string): Promise<
  {
    id: string;
    userId: string;
    level: AccessLevel;
    user: { id: string; name: string | null; image: string | null };
  }[]
> {
  const members = await db.chatMember.findMany({
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
async function emitMemberUpdate(chatId: string): Promise<void> {
  const members = await fetchChatMembers(chatId);
  // quickdraw-migrate: review [emit] room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
  this.emitToRoom(serviceRoom("chatService", chatId), "chat:memberUpdate", { members });
}

export const chatService = qd.defineService(chatContract, {
  model: "chat",
  // quickdraw-migrate: review [access-override] 4.x decided row access in checkAccess and checkEntryACL (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
  access: resolver({ levelsFor: () => ({}) }),
  methods: {
    // quickdraw-migrate: review [kit] createChat has the shape of the read/write kit's create, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    createChat: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx }) => {
        // quickdraw-migrate: review [write] 4.x CRUD helper this.create: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.create(...) instead (frames follow the tracked write; hooks do not run; db.create throws on failure)
        const chat = await this.create({
          title: input.title,
          members: {
            create: [
              { userId: ctx.principal.userId, level: "Admin" },
              ...(input.members?.map((m) => ({
                userId: m.userId,
                level: m.level,
              })) ?? []),
            ],
          },
        });

        return { id: chat.id };
      },
    },
    updateTitle: {
      access: { service: "Moderate", entry: "Moderate", id: "id" },
      handler: async ({ input }) => {
        // quickdraw-migrate: review [write] 4.x CRUD helper this.update: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.update(...) instead (frames follow the tracked write; hooks do not run; 4.x returned null for a missing row where db.update throws NOT_FOUND)
        const updated = await this.update(input.id, { title: input.title });
        if (!updated) return null;
        return { id: updated.id, title: updated.title };
      },
    },
    // quickdraw-migrate: review [kit] deleteChat has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    deleteChat: {
      access: { service: "Admin", entry: "Admin", id: "id" },
      handler: async ({ input }) => {
        const memberIds = await memberUserIds(input.id);
        // quickdraw-migrate: review [write] 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)
        const deleted = await this.delete(input.id);
        if (!deleted) throw new Error("Chat not found");

        for (const userId of memberIds) {
          // quickdraw-migrate: review [emit] hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
          this.emitCollectionRemove("myChats", userId, input.id);
        }
        return { id: input.id, deleted: true as const };
      },
    },
    getChatMembers: {
      access: { service: "Read", entry: "Read", id: "chatId" },
      handler: async ({ input }) => {
        return await fetchChatMembers(input.chatId);
      },
    },
    inviteUser: {
      access: { service: "Moderate", entry: "Moderate", id: "id" },
      handler: async ({ input, db }) => {
        // Add or update membership (single atomic operation)
        await db.chatMember.upsert({
          where: {
            chatId_userId: { chatId: input.id, userId: input.userId },
          },
          update: { level: input.level },
          create: {
            chatId: input.id,
            userId: input.userId,
            level: input.level,
          },
        });

        // Emit member update to all subscribers
        await emitMemberUpdate(input.id);
        // The invited user's myChats gains the chat; everyone's memberCount moves
        await refreshMyChatsItem(input.id);

        return { id: input.id };
      },
    },
    // quickdraw-migrate: review [kit] inviteByName has the shape of the sharing kit's inviteByName, which checks access on every row it touches, pages and stays live: replace it with sharing.handlers (sharing.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    inviteByName: {
      access: { service: "Moderate", entry: "Moderate", id: "chatId" },
      handler: async ({ input, db }) => {
        // Look up user by name
        const user = await db.user.findUnique({
          where: { name: input.userName },
          select: { id: true },
        });

        if (!user) {
          return { error: "user_not_found" as const };
        }

        // Add or update membership
        await db.chatMember.upsert({
          where: {
            chatId_userId: { chatId: input.chatId, userId: user.id },
          },
          update: { level: input.level },
          create: {
            chatId: input.chatId,
            userId: user.id,
            level: input.level,
          },
        });

        // Emit member update to all subscribers
        await emitMemberUpdate(input.chatId);
        // The invited user's myChats gains the chat; everyone's memberCount moves
        await refreshMyChatsItem(input.chatId);

        return { id: input.chatId };
      },
    },
    removeUser: {
      access: { service: "Moderate", entry: "Moderate", id: "id" },
      handler: async ({ input, db }) => {
        await db.chatMember.delete({
          where: {
            chatId_userId: { chatId: input.id, userId: input.userId },
          },
        });

        // Emit member update to all subscribers
        await emitMemberUpdate(input.id);
        // The chat vanishes from the removed user's list; counts move for the rest
        // quickdraw-migrate: review [emit] hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
        this.emitCollectionRemove("myChats", input.userId, input.id);
        await refreshMyChatsItem(input.id);

        return { id: input.id };
      },
    },
    leaveChat: {
      access: { service: "Read", entry: "Read", id: "id" },
      handler: async ({ input, ctx, db }) => {
        await db.chatMember.delete({
          where: { chatId_userId: { chatId: input.id, userId: ctx.principal.userId } },
        });

        // Emit member update to all subscribers
        await emitMemberUpdate(input.id);
        // The chat vanishes from the leaver's list; counts move for the rest
        // quickdraw-migrate: review [emit] hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
        this.emitCollectionRemove("myChats", ctx.principal.userId, input.id);
        await refreshMyChatsItem(input.id);

        return { id: input.id };
      },
    },
  },
});
