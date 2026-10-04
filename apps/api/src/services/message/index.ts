import type { Message } from "@project/db";
import type { MessageDTO, AccessLevel } from "@project/shared";
import { jsonAcl } from "@fitzzero/quickdraw-core/server";
// quickdraw-migrate: review [v4-api] 4.x API CollectionSnapshotPage (removed): lint's no-v4-api names each replacement
import type { CollectionSnapshotPage } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { cursorPageArgs, sliceCursorPage } from "../shared/index.js";
import { qd } from "../../quickdraw.js";
import { messageContract } from "@project/shared";
import { db } from "../../db.js";

// Zod schemas for validation
// Admin schema - defines fields available for admin CRUD
const adminMessageSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  content: z.string(),
  role: z.enum(["user", "assistant", "system"]),
});

// The live message history of one chat. Scope = chat id; membership is a
// pure function of the row (message.chatId), so the CRUD trio emits
// added/removed deltas with zero extra code. `ids` is deliberately never
// returned (unbounded history — see byChatSnapshot), so reconnecting
// clients merge without pruning and keep their paged-in history.
// quickdraw-migrate: review [collection] 4.x collection "byChat": declare it in the contract's collections (scope, item, order) and anchor it in defineService's collections, then delete this; it is no longer used
const byChatCollection = {
  resolveScopeId: (message) => message.chatId,
  checkScopeAccess: (userId, chatId) => checkChatAccess(userId, chatId, "Read"),
  snapshot: (chatId, opts) => byChatSnapshot(chatId, opts),
  defaultLimit: 50,
  // toItem omitted: defaults to this service's toDto
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
  schema: adminMessageSchema,
  displayName: "Messages",
  tableColumns: ["id", "chatId", "userId", "role", "createdAt"],
};

// Wire shape: ISO createdAt + the author's public profile. The user fetch
// makes this async — fine, toDto may return a promise.
// quickdraw-migrate: review [projection] 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
async function toDto(message: Message): Promise<MessageDTO> {
  const user = await db.user.findUnique({
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
async function checkChatAccess(
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

/**
 * First page + reconnect re-snapshot for `byChat`: newest messages first,
 * cursor = oldest message id of the page (loadMore walks into history).
 * No `ids` — chat history is unbounded, so deletion pruning is traded for
 * keeping paged-in history across reconnects.
 */
async function byChatSnapshot(
  chatId: string,
  opts: { cursor: string | null; limit: number },
): Promise<CollectionSnapshotPage<MessageDTO>> {
  const messages = await db.message.findMany({
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
  const totalCount = await db.message.count({ where: { chatId } });

  return { items, nextCursor, totalCount };
}

// Write lifecycle hooks: keep the parent chat's `myChats` items fresh
// (lastMessageAt drives sidebar ordering) without touching the write paths
// quickdraw-migrate: review [lifecycle] 4.x lifecycle hook, run only by this.create: move what it does into the methods that create rows (or affects, for rows of other services), then delete it
async function afterCreate(message: Message): Promise<void> {
  // quickdraw-migrate: review [this] this.chatService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  await this.chatService?.refreshMyChatsItem(message.chatId);
  // Fire-and-forget web push to offline chat members (no-op without VAPID)
  // quickdraw-migrate: review [this] this.pushService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  this.pushService?.notifyNewMessage(message);
}

// quickdraw-migrate: review [lifecycle] 4.x lifecycle hook, run only by this.delete: move what it does into the methods that delete rows (or affects), then delete it
async function afterDelete(message: Message): Promise<void> {
  // quickdraw-migrate: review [this] this.chatService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  await this.chatService?.refreshMyChatsItem(message.chatId);
}

export const messageService = qd.defineService(messageContract, {
  model: "message",
  // quickdraw-migrate: review [access] 4.x's hasEntryACL read the row's `acl` column ([{ userId, level }]), and so does jsonAcl("acl"), with one difference: a user with several entries in a row's list gets the highest of their levels, where 4.x took the first. Check the stored lists for duplicate entries
  access: jsonAcl("acl"),
  methods: {
    postMessage: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx }) => {
        // Check chat access
        const hasAccess = await checkChatAccess(ctx.principal.userId, input.chatId, "Read");
        if (!hasAccess) throw new Error("Access denied to chat");

        // The CRUD trio does all the realtime work: entity event to message
        // subscribers, `byChat` `added` delta to everyone watching the chat,
        // and afterCreate refreshes the chat's `myChats` items. (Before 4.0
        // this method hand-emitted a "chat:message" room event — that whole
        // compensation layer is what collections replace.)
        // quickdraw-migrate: review [write] 4.x CRUD helper this.create: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.message.create(...) instead (frames follow the tracked write; hooks do not run; db.create throws on failure)
        const message = await this.create({
          chatId: input.chatId,
          userId: ctx.principal.userId,
          content: input.content,
          role: input.role ?? "user",
          // Creator gets Admin access in ACL for delete permissions
          acl: [{ userId: ctx.principal.userId, level: "Admin" }],
        });

        return { id: message.id };
      },
    },
    // quickdraw-migrate: review [kit] deleteMessage has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
    deleteMessage: {
      access: { service: "Admin", entry: "Admin", id: "id" },
      handler: async ({ input }) => {
        // quickdraw-migrate: review [write] 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.message.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)
        const deleted = await this.delete(input.id);
        if (!deleted) throw new Error("Message not found");
        return { id: input.id, deleted: true as const };
      },
    },
  },
});
