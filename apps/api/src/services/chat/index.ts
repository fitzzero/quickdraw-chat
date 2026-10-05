import { QuickdrawError } from "@fitzzero/quickdraw-core";
import {
  admin,
  members,
  type BaseContext,
  type Principal,
  type RoomLeaveHandler,
} from "@fitzzero/quickdraw-core/server";
import { chatContract } from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import {
  changeMembership,
  isForeignKeyFailure,
  listMembers,
  type MembershipChange,
} from "./membership.js";
// ── quickdraw-game:start ──
import { gameContract } from "@project/shared";
import { joinChat } from "./membership.js";
// ── quickdraw-game:end ──

type Db = typeof appDb;

/**
 * A chat's roster room: the sockets showing the chat's members, which
 * `getChatMembers` puts there and `memberUpdate` goes to.
 */
function rosterRoom(chatId: string): string {
  return `chat:${chatId}`;
}

/**
 * The roster room each socket is in, by socket id. A socket shows one chat's
 * members at a time (the chat page's sidebar), so reading another chat's
 * roster moves it: its app rooms never pile up (a socket may be in 100).
 */
const rosterRoomOf = new Map<string, string>();

/** Puts the calling socket in the chat's roster room, out of the one it was in. */
function showRoster(ctx: Pick<BaseContext, "rooms" | "socketId">, chatId: string): void {
  const { socketId } = ctx;
  // a call without a socket (HTTP, MCP, in process) hears no event
  if (socketId === undefined) return;
  const room = rosterRoom(chatId);
  const before = rosterRoomOf.get(socketId);
  if (before !== undefined && before !== room) ctx.rooms.leave(before);
  if (ctx.rooms.join(room)) rosterRoomOf.set(socketId, room);
}

/** Forgets the roster room of a socket that left it (removed from the chat, or gone). */
const forgetRoster: RoomLeaveHandler = ({ socketId, rooms }) => {
  const room = rosterRoomOf.get(socketId);
  if (room !== undefined && rooms.some((left) => left.room === room)) {
    rosterRoomOf.delete(socketId);
  }
};

/**
 * A membership write's follow-up: the sockets showing the chat's members get
 * the new list (`memberUpdate`, to the roster room), after a member who left
 * or was removed is taken out of that room on every node, so they hear
 * nothing more. The tracked writes decide the rest: who joined or left a
 * member's `myChats` list and who lost access to the chat (the membership
 * row), and the new member count in the lists that still hold the chat (its
 * `memberCount`, written in the same transaction).
 */
async function membersChanged(
  ctx: Pick<BaseContext, "rooms">,
  db: Db,
  chatId: string,
  gone: string | null = null,
): Promise<void> {
  if (gone !== null) {
    await ctx.rooms.leave(rosterRoom(chatId), { userId: gone });
  }
  ctx.rooms.emit(rosterRoom(chatId), chatContract, "memberUpdate", {
    chatId,
    members: await listMembers(db, chatId),
  });
}

/**
 * Changes a chat's members under the sharing kit's rules (`changeMembership`
 * in `membership.ts`: nobody gives above their own level, only an Admin
 * changes a member at or above the caller's level, the last Admin stays),
 * then tells the roster's viewers when anything changed.
 */
async function changeMembers(
  ctx: Pick<BaseContext, "rooms"> & { readonly principal: Principal },
  db: Db,
  change: MembershipChange,
): Promise<void> {
  if (await changeMembership(ctx.principal, db, change)) {
    await membersChanged(ctx, db, change.chatId, change.level === null ? change.userId : null);
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
        try {
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
        } catch (error) {
          // a member to add who is no user: the input's fault, nothing written
          if (isForeignKeyFailure(error)) {
            throw new QuickdrawError("VALIDATION", "A member to add is not a user", {
              issues: [{ path: ["members"], message: "A member to add is not a user" }],
            });
          }
          throw error;
        }
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
      // the calling socket now hears the chat's memberUpdate events (the web
      // calls this with useJoin, again on every connection)
      handler: ({ input, ctx, db }) => {
        showRoster(ctx, input.chatId);
        return listMembers(db, input.chatId);
      },
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
        const joined =
          chatId !== null && (await joinChat(db, chatId, ctx.principal.userId, "Read"));
        // The world chat holds every player: its roster is read again only
        // when someone shows it (the game runs on one node, game-patterns.md,
        // so this node's room is everyone's)
        if (joined && ctx.rooms.size(rosterRoom(chatId)) > 0) {
          await membersChanged(ctx, db, chatId);
        }
        return { chatId };
      },
    },
    // ── quickdraw-game:end ──
    ...admin.handlers(chatContract, {
      displayName: "Chats",
      // kept by messageService (its posts and deletes), not edited by hand
      fieldOverrides: { lastMessageAt: { editable: false } },
    }),
  },
  // a socket that left its roster room is forgotten (see rosterRoomOf)
  onRoomLeave: forgetRoster,
});
