// The contract of chatService: the chat entity, its membership methods, the
// `listItem` projection, the `myChats` collection, the `memberUpdate` event
// and the admin kit.

import { admin, defineContract, mutation, query, via } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  accessLevelSchema,
  byIdSchema,
  cuidSchema,
  deletedResultSchema,
  idResultSchema,
  isoDateSchema,
  publicProfileSchema,
} from "./helpers.js";

const createChatSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
  members: z
    .array(
      z.object({
        userId: cuidSchema("user ID"),
        level: z.enum(["Read", "Moderate", "Admin"]),
      }),
    )
    .optional(),
});

const updateTitleSchema = z.object({
  id: cuidSchema("chat ID"),
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
});

const getChatMembersSchema = z.object({
  chatId: cuidSchema("chat ID"),
});

const inviteUserSchema = z.object({
  id: cuidSchema("chat ID"),
  userId: cuidSchema("user ID"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const inviteByNameSchema = z.object({
  chatId: cuidSchema("chat ID"),
  userName: z.string().min(1, "Username is required"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const removeUserSchema = z.object({
  id: cuidSchema("chat ID"),
  userId: cuidSchema("user ID"),
});

/**
 * A chat row, as its subscribers receive it. Access to a chat is its
 * membership table (`ChatMember`), not a column of the row.
 *
 * `lastMessageAt` is a maintained column: the chat's `createdAt` when it is
 * created, then the time of its latest message. It exists so the `myChats`
 * order can name it: an order names columns only, so a computed "latest
 * activity" would have to be sorted on the client.
 */
export const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  lastMessageAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

/**
 * One item of `myChats`: the columns a chat list shows. `memberCount` is a
 * column the membership writes keep (`Chat.memberCount`), so a list reads no
 * member; the entity leaves it out (nobody edits it by hand).
 */
export const chatListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  memberCount: z.number().int().nonnegative(),
  lastMessageAt: isoDateSchema,
  createdAt: isoDateSchema,
});

/** One member of a chat: the membership row, its level and the member's public profile. */
export const chatMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  level: accessLevelSchema,
  user: publicProfileSchema,
});

export const chatContract = defineContract("chatService", {
  entity: chatSchema,
  projections: { listItem: chatListItemSchema },
  methods: {
    createChat: mutation({
      input: createChatSchema,
      output: idResultSchema,
      describe: "Creates a chat with the caller as its Admin, plus any members given.",
    }),
    updateTitle: mutation({
      input: updateTitleSchema,
      // The row itself, so a rename shows at once (an "entity" mutation with
      // an id is optimistic); a missing chat is NOT_FOUND.
      output: "entity",
      describe: "Renames a chat.",
    }),
    deleteChat: mutation({
      input: byIdSchema,
      output: deletedResultSchema,
      describe: "Deletes a chat with its memberships and messages.",
    }),
    getChatMembers: query({
      input: getChatMembersSchema,
      output: z.array(chatMemberSchema),
      describe: "Lists a chat's members, oldest first, with their level and public profile.",
    }),
    // The membership changes follow the sharing kit's rules: nobody gives a
    // level above their own, only an Admin changes or removes a member at or
    // above the caller's level (FORBIDDEN), and the chat's last Admin is never
    // removed, demoted or let go (CONFLICT)
    inviteUser: mutation({
      input: inviteUserSchema,
      output: idResultSchema,
      describe:
        "Adds a user to a chat at a level, or changes the level of a member: never above the caller's own level, a member at or above the caller's level only by an Admin, and never the chat's last Admin.",
    }),
    inviteByName: mutation({
      input: inviteByNameSchema,
      output: z.union([idResultSchema, z.object({ error: z.literal("user_not_found") })]),
      describe:
        'Adds a user to a chat by their unique name, as inviteUser does; answers { error: "user_not_found" } when nobody has it.',
    }),
    removeUser: mutation({
      input: removeUserSchema,
      output: idResultSchema,
      describe:
        "Removes a member from a chat: a member at or above the caller's level only by an Admin, and never the chat's last Admin.",
    }),
    leaveChat: mutation({
      input: byIdSchema,
      output: idResultSchema,
      describe: "Removes the caller from a chat, unless they are its last Admin.",
    }),
    // ── quickdraw-game:start ──
    // Everyone in a game world is in its chat (the in-game chat overlay): the
    // game's methods call this through ctx.services, so the membership is
    // written by the chat service, which owns memberships
    joinWorldChat: mutation({
      input: z.object({ worldId: z.string().min(1) }),
      output: z.object({ chatId: z.string().nullable() }),
      describe:
        "Adds the caller to a game world's chat at Read when they are not a member yet; answers the chat's id, or null for a world without one.",
    }),
    // ── quickdraw-game:end ──
    // The admin screens: every chat, for holders of a service-wide Admin grant
    ...admin.contract({ entity: chatSchema, sort: ["createdAt", "title", "lastMessageAt"] }),
  },
  collections: {
    // Each chat in the list of every member: the scope is a user id, through
    // the membership table, so one chat fans out to all of its members' lists.
    // A membership write also writes the chat's `memberCount`, which sends
    // the chat again to the lists that still hold it.
    myChats: {
      scope: via({ model: "chatMember", entry: "chatId", scope: "userId" }),
      item: "listItem",
      // most recent activity first
      order: [
        ["lastMessageAt", "desc"],
        ["id", "desc"],
      ],
      // the whole list, small, with the first page: the sidebar knows every
      // chat (and drops the ones deleted while it was offline) without paging
      index: ["lastMessageAt", "title", "memberCount"],
    },
  },
  events: {
    // Sent to each member (emitToUser) whenever the chat's members change,
    // with the chat's id so a client showing several chats can tell them apart
    memberUpdate: {
      payload: z.object({ chatId: z.string(), members: z.array(chatMemberSchema) }),
    },
  },
});
