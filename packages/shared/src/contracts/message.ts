// The contract of messageService, written by @fitzzero/quickdraw-codemod from
// MessageServiceMethods and the defineMethod calls of MessageService
// (apps/api/src/services/message/index.ts), then completed by hand: real output
// schemas, the entity, the `withAuthor` projection and the `byChat` collection.

import { defineContract, mutation } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  byIdSchema,
  cuidSchema,
  deletedResultSchema,
  idResultSchema,
  isoDateSchema,
  publicProfileSchema,
} from "./helpers.js";

const messageRoleSchema = z.enum(["user", "assistant", "system"]);

const postMessageSchema = z.object({
  chatId: cuidSchema("chat ID"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content must be 10000 characters or less"),
  role: messageRoleSchema.optional(),
});

/**
 * A message row, as its subscribers receive it. The row's `acl` column (its
 * author holds Admin there, which lets them delete it) is read by the access
 * policy and never sent.
 */
export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  userId: z.string(),
  content: z.string(),
  role: messageRoleSchema,
  createdAt: isoDateSchema,
});

/** A message with its author's public profile: what a chat's history shows. */
export const messageWithAuthorSchema = messageSchema.extend({
  user: publicProfileSchema,
});

export const messageContract = defineContract("messageService", {
  entity: messageSchema,
  projections: { withAuthor: messageWithAuthorSchema },
  methods: {
    postMessage: mutation({
      input: postMessageSchema,
      output: idResultSchema,
      describe: "Posts a message to a chat the caller is a member of.",
    }),
    deleteMessage: mutation({
      input: byIdSchema,
      output: deletedResultSchema,
      describe: "Deletes a message: its author's, or any with a service-wide Admin grant.",
    }),
  },
  collections: {
    // A chat's live history. Newest first, so the first page is the latest
    // messages and each further page walks back in time; the chat window
    // shows the items oldest first.
    byChat: {
      scope: "chatId",
      item: "withAuthor",
      order: [
        ["createdAt", "desc"],
        ["id", "desc"],
      ],
      limit: 50,
    },
  },
});
