// The contract of messageService, written by @fitzzero/quickdraw-codemod from
// MessageServiceMethods and the defineMethod calls of MessageService
// (apps/api/src/services/message/index.ts), then completed by hand: real output
// schemas, the entity, the `withAuthor` projection, the `byChat` collection and
// the admin kit.

import { admin, defineContract, mutation } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  byIdSchema,
  cuidSchema,
  deletedResultSchema,
  idResultSchema,
  isoDateSchema,
  publicProfileSchema,
} from "./helpers.js";

const postMessageSchema = z.object({
  chatId: cuidSchema("chat ID"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content must be 10000 characters or less"),
  role: z.enum(["user", "assistant", "system"]).optional(),
});

/**
 * A message row, as its subscribers receive it. Who may read one is decided by
 * its chat (members read its messages); its author also holds Admin on it, so
 * may delete it. `role` is "user", "assistant" or "system", but a string as
 * the column is: handlers return database rows for this entity, and a
 * narrower type than the column's would refuse them.
 */
export const messageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  userId: z.string(),
  content: z.string(),
  role: z.string(),
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
      describe:
        "Deletes a message: its author may, as may its chat's Admins and holders of a service-wide Admin grant.",
    }),
    // The admin screens: every message, for holders of a service-wide Admin grant
    ...admin.contract({ entity: messageSchema, filter: ["chatId", "userId"], sort: ["createdAt"] }),
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
