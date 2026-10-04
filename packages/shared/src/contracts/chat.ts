// The contract of chatService, written by @fitzzero/quickdraw-codemod from
// ChatServiceMethods and the defineMethod calls of ChatService
// (apps/api/src/services/chat/index.ts), then completed by hand: real output
// schemas, the entity, the `listItem` projection, the `myChats` collection
// and the `memberUpdate` event.

import { defineContract, mutation, query, via } from "@fitzzero/quickdraw-core";
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
 * order can name it (an order names columns only), where 4.x sorted the list
 * on the client by `lastMessageAt ?? createdAt`.
 */
export const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  lastMessageAt: isoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

/**
 * One item of `myChats`. `memberCount` is computed (the service's projection
 * reads the relation count and maps it), so the item is a projection of its
 * own rather than the entity.
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
      // The row itself, so a rename shows at once (optimistic) where 4.x bound a
      // SocketTextField; a missing chat is NOT_FOUND where 4.x answered null.
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
    inviteUser: mutation({
      input: inviteUserSchema,
      output: idResultSchema,
      describe: "Adds a user to a chat at a level, or changes the level of a member.",
    }),
    inviteByName: mutation({
      input: inviteByNameSchema,
      output: z.union([idResultSchema, z.object({ error: z.literal("user_not_found") })]),
      describe:
        'Adds a user to a chat by their unique name; answers { error: "user_not_found" } when nobody has it.',
    }),
    removeUser: mutation({
      input: removeUserSchema,
      output: idResultSchema,
      describe: "Removes a member from a chat.",
    }),
    leaveChat: mutation({
      input: byIdSchema,
      output: idResultSchema,
      describe: "Removes the caller from a chat.",
    }),
  },
  collections: {
    // Each chat in the list of every member: the scope is a user id, through
    // the membership table, so one chat fans out to all of its members' lists.
    myChats: {
      scope: via({ model: "chatMember", entry: "chatId", scope: "userId" }),
      item: "listItem",
      // most recent activity first
      order: [
        ["lastMessageAt", "desc"],
        ["id", "desc"],
      ],
    },
  },
  events: {
    // was the 4.x room event "chat:memberUpdate", sent to the chat's room
    memberUpdate: { payload: z.object({ members: z.array(chatMemberSchema) }) },
  },
});
