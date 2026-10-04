import { QuickdrawError } from "@fitzzero/quickdraw-core";
import {
  admin,
  meetsLevel,
  members,
  serviceGrant,
  type BaseContext,
} from "@fitzzero/quickdraw-core/server";
import { chatContract, type AccessLevel, type ChatMemberDTO } from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";

type Db = typeof appDb;

/** The most members `getChatMembers` lists, and `memberUpdate` carries. */
const MAX_LISTED_MEMBERS = 500;

/** A chat's members, oldest first, each with their level and public profile. */
async function listMembers(db: Db, chatId: string): Promise<ChatMemberDTO[]> {
  const rows = await db.chatMember.findMany({
    where: { chatId },
    select: {
      id: true,
      userId: true,
      level: true,
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_LISTED_MEMBERS,
  });
  // The column holds the level names the members policy reads
  return rows.map((row) => ({ ...row, level: row.level as AccessLevel }));
}

/**
 * A membership write's follow-up: each member still in the chat gets the new
 * member list (`memberUpdate`). The tracked membership write itself decides
 * the rest: who joined or left a member's `myChats` list, who lost access to
 * the chat, and (`refreshEntry` on the collection) the new member count in
 * the lists that still hold the chat.
 */
async function membersChanged(
  ctx: Pick<BaseContext, "rooms">,
  db: Db,
  chatId: string,
): Promise<void> {
  const current = await listMembers(db, chatId);
  for (const member of current) {
    ctx.rooms.emitToUser(member.userId, chatContract, "memberUpdate", {
      chatId,
      members: current,
    });
  }
}

/**
 * Refuses a level above the caller's own on the chat: their membership's
 * level, or their service-wide chatService grant when it is higher (a
 * service-wide Admin grant may give any level). The sharing kit's rule:
 * without it a Moderate could make anyone, themself included, an Admin.
 */
async function checkGrantable(
  ctx: Pick<BaseContext, "principal">,
  db: Db,
  chatId: string,
  level: AccessLevel,
): Promise<void> {
  const grant = serviceGrant(ctx.principal, "chatService");
  if (meetsLevel(grant, level)) {
    return;
  }
  const own = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId: ctx.principal.userId } },
    select: { level: true },
  });
  if (!meetsLevel(own?.level as AccessLevel | undefined, level)) {
    throw new QuickdrawError("FORBIDDEN", "Members may invite at their own level at most");
  }
}

/**
 * Chats: the membership-table access pattern. A chat's level comes from its
 * ChatMember row (`members`), and `myChats` lists each user's chats through
 * that table (`via`), so a membership write moves the chat in and out of the
 * member's list and grants or revokes their access at once.
 */
export const chatService = qd.defineService(chatContract, {
  model: "chat",
  // ChatMember.level holds the level names themselves: Read, Moderate, Admin
  access: members({ model: "chatMember", entry: "chatId", user: "userId", level: "level" }),
  writes: ["chatMember"],
  collections: { myChats: { scopeAccess: "self" } },
  project: {
    listItem: {
      // the members' ids, counted in `map`: a relation `_count` would group
      // the whole membership table on every read
      select: {
        title: true,
        lastMessageAt: true,
        createdAt: true,
        members: { select: { id: true } },
      },
      map: (row: {
        id: string;
        title: string;
        lastMessageAt: Date;
        createdAt: Date;
        members: readonly { id: string }[];
      }) => ({
        id: row.id,
        title: row.title,
        memberCount: row.members.length,
        lastMessageAt: row.lastMessageAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }),
    },
  },
  methods: {
    // quickdraw: hand-written because it creates the chat together with its memberships (the caller as Admin, plus the members invited with it) in one transaction, where the read/write kit's create writes one row
    createChat: {
      // any signed-in user may start a chat: names no row by id
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        const creator = ctx.principal.userId;
        const invited = (input.members ?? []).filter((member) => member.userId !== creator);
        return await db.$transaction(async (tx) => {
          const chat = await tx.chat.create({ data: { title: input.title }, select: { id: true } });
          await tx.chatMember.createMany({
            data: [
              { chatId: chat.id, userId: creator, level: "Admin" },
              ...invited.map((member) => ({
                chatId: chat.id,
                userId: member.userId,
                level: member.level,
              })),
            ],
          });
          return { id: chat.id };
        });
      },
    },
    updateTitle: {
      access: { service: "Moderate", entry: "Moderate" },
      handler: ({ input, db }) =>
        db.chat.update({ where: { id: input.id }, data: { title: input.title } }),
    },
    // quickdraw: hand-written because it answers { id, deleted } as the chat sidebar expects; the database cascade removes the memberships and messages, and the deleted anchor closes every byChat scope of the chat
    deleteChat: {
      access: { service: "Admin", entry: "Admin" },
      handler: async ({ input, db }) => {
        await db.chat.delete({ where: { id: input.id }, select: { id: true } });
        return { id: input.id, deleted: true as const };
      },
    },
    getChatMembers: {
      access: { service: "Read", entry: "Read", id: "chatId" },
      handler: ({ input, db }) => listMembers(db, input.chatId),
    },
    inviteUser: {
      access: { service: "Moderate", entry: "Moderate" },
      handler: async ({ input, ctx, db }) => {
        await checkGrantable(ctx, db, input.id, input.level);
        await db.chatMember.upsert({
          where: { chatId_userId: { chatId: input.id, userId: input.userId } },
          update: { level: input.level },
          create: { chatId: input.id, userId: input.userId, level: input.level },
        });
        await membersChanged(ctx, db, input.id);
        return { id: input.id };
      },
    },
    // quickdraw: hand-written because it answers { error: "user_not_found" } for an unknown name and keeps the chat's id as `chatId`, as the web app's invite box expects; the sharing kit's inviteByName answers NOT_FOUND
    inviteByName: {
      access: { service: "Moderate", entry: "Moderate", id: "chatId" },
      handler: async ({ input, ctx, db }) => {
        const user = await db.user.findUnique({
          where: { name: input.userName },
          select: { id: true },
        });
        if (!user) {
          return { error: "user_not_found" as const };
        }
        await checkGrantable(ctx, db, input.chatId, input.level);
        await db.chatMember.upsert({
          where: { chatId_userId: { chatId: input.chatId, userId: user.id } },
          update: { level: input.level },
          create: { chatId: input.chatId, userId: user.id, level: input.level },
        });
        await membersChanged(ctx, db, input.chatId);
        return { id: input.chatId };
      },
    },
    removeUser: {
      access: { service: "Moderate", entry: "Moderate" },
      handler: async ({ input, ctx, db }) => {
        await db.chatMember.delete({
          where: { chatId_userId: { chatId: input.id, userId: input.userId } },
        });
        await membersChanged(ctx, db, input.id);
        return { id: input.id };
      },
    },
    leaveChat: {
      access: { service: "Read", entry: "Read" },
      handler: async ({ input, ctx, db }) => {
        await db.chatMember.delete({
          where: { chatId_userId: { chatId: input.id, userId: ctx.principal.userId } },
        });
        await membersChanged(ctx, db, input.id);
        return { id: input.id };
      },
    },
    ...admin.handlers(chatContract, {
      displayName: "Chats",
      // kept by messageService.postMessage, not edited by hand
      fieldOverrides: { lastMessageAt: { editable: false } },
    }),
  },
});
