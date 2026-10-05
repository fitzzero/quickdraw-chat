import { admin, members, type BaseContext, type Principal } from "@fitzzero/quickdraw-core/server";
import { chatContract } from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import { changeMembership, listMembers, type MembershipChange } from "./membership.js";
// ── quickdraw-game:start ──
import { gameContract } from "@project/shared";
import { joinChat } from "./membership.js";
// ── quickdraw-game:end ──

type Db = typeof appDb;

/**
 * A membership write's follow-up: each member still in the chat gets the new
 * member list (`memberUpdate`). The tracked writes decide the rest: who joined
 * or left a member's `myChats` list and who lost access to the chat (the
 * membership row), and the new member count in the lists that still hold the
 * chat (its `memberCount`, written in the same transaction).
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
 * Changes a chat's members under the sharing kit's rules (`changeMembership`
 * in `membership.ts`: nobody gives above their own level, only an Admin
 * changes a member at or above the caller's level, the last Admin stays),
 * then tells the members when anything changed.
 */
async function changeMembers(
  ctx: Pick<BaseContext, "rooms"> & { readonly principal: Principal },
  db: Db,
  change: MembershipChange,
): Promise<void> {
  if (await changeMembership(ctx.principal, db, change)) {
    await membersChanged(ctx, db, change.chatId);
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
  // `listItem` is columns only (`memberCount` is a maintained column): the
  // framework selects it from the row, so a list reads no member
  collections: { myChats: { scopeAccess: "self" } },
  methods: {
    // quickdraw: hand-written because it creates the chat together with its memberships (the caller as Admin, plus the members invited with it) in one transaction, where the read/write kit's create writes one row
    createChat: {
      // any signed-in user may start a chat: names no row by id
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        const creator = ctx.principal.userId;
        const invited = (input.members ?? []).filter((member) => member.userId !== creator);
        return await db.$transaction(async (tx) => {
          const chat = await tx.chat.create({
            data: { title: input.title, memberCount: 1 + invited.length },
            select: { id: true },
          });
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
    // quickdraw: hand-written because a Moderate invites and removes here (the sharing kit's members mode lets only Admins change members by default and caps no change to a member above the caller), and one method both invites and changes a member's level, as the web app's invite box expects; the kit's three rules apply in changeMembership
    inviteUser: {
      access: { service: "Moderate", entry: "Moderate" },
      handler: async ({ input, ctx, db }) => {
        await changeMembers(ctx, db, {
          chatId: input.id,
          userId: input.userId,
          level: input.level,
        });
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
        await changeMembers(ctx, db, {
          chatId: input.chatId,
          userId: user.id,
          level: input.level,
        });
        return { id: input.chatId };
      },
    },
    removeUser: {
      access: { service: "Moderate", entry: "Moderate" },
      handler: async ({ input, ctx, db }) => {
        await changeMembers(ctx, db, { chatId: input.id, userId: input.userId, level: null });
        return { id: input.id };
      },
    },
    leaveChat: {
      access: { service: "Read", entry: "Read" },
      handler: async ({ input, ctx, db }) => {
        await changeMembers(ctx, db, {
          chatId: input.id,
          userId: ctx.principal.userId,
          level: null,
          leaving: true,
        });
        return { id: input.id };
      },
    },
    // ── quickdraw-game:start ──
    joinWorldChat: {
      // every signed-in user may be in a world (the game's policy gives
      // everyone Read on every world), and so in its chat
      access: { scope: "Read", of: gameContract, id: "worldId" },
      handler: async ({ input, ctx, db }) => {
        const world = await db.gameWorld.findUnique({
          where: { id: input.worldId },
          select: { chatId: true },
        });
        const chatId = world?.chatId ?? null;
        if (chatId !== null) {
          await joinChat(db, chatId, ctx.principal.userId, "Read");
        }
        return { chatId };
      },
    },
    // ── quickdraw-game:end ──
    ...admin.handlers(chatContract, {
      displayName: "Chats",
      // kept by messageService.postMessage, not edited by hand
      fieldOverrides: { lastMessageAt: { editable: false } },
    }),
  },
});
