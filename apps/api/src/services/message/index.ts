import { admin, anyOf, inherit, owner } from "@fitzzero/quickdraw-core/server";
import { chatContract, messageContract } from "@project/shared";
import { qd } from "../../quickdraw.js";
import { notifyNewMessage } from "../push-subscription/index.js";

/**
 * Messages: access inherited from the chat a message belongs to, which is
 * also what opens a chat's `byChat` history (its anchor), so everyone who may
 * read the chat sees every message in it, and nobody else does. The author
 * holds Admin on their own messages on top (4.x stored that in each row's
 * `acl` column), so they may delete them.
 */
export const messageService = qd.defineService(messageContract, {
  model: "message",
  access: anyOf(inherit({ from: chatContract, via: "chatId" }), owner("userId")),
  // postMessage keeps its chat's lastMessageAt current
  writes: ["chat"],
  collections: { byChat: { anchor: chatContract } },
  project: {
    withAuthor: {
      select: {
        chatId: true,
        userId: true,
        content: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, image: true } },
      },
      map: (row: {
        id: string;
        chatId: string;
        userId: string;
        content: string;
        role: string;
        createdAt: Date;
        user: { id: string; name: string | null; image: string | null };
      }) => ({
        id: row.id,
        chatId: row.chatId,
        userId: row.userId,
        content: row.content,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
        user: row.user,
      }),
    },
  },
  methods: {
    postMessage: {
      // a member of the chat, at Read or above (4.x: any signed-in user, then
      // an inline membership check)
      access: { scope: "Read", of: chatContract, id: "chatId" },
      handler: async ({ input, ctx, db }) => {
        const message = await db.$transaction(async (tx) => {
          const created = await tx.message.create({
            data: {
              chatId: input.chatId,
              userId: ctx.principal.userId,
              content: input.content,
              role: input.role ?? "user",
            },
            select: { id: true, chatId: true, userId: true, content: true, createdAt: true },
          });
          // The chat's latest activity: the myChats lists order by it
          await tx.chat.update({
            where: { id: input.chatId },
            data: { lastMessageAt: created.createdAt },
            select: { id: true },
          });
          return created;
        });
        // Web push to the members with no live socket; never fails the post
        notifyNewMessage(db, message);
        return { id: message.id };
      },
    },
    // quickdraw: hand-written because it answers { id, deleted } as callers of 4.x's deleteMessage expect; the read/write kit's delete answers null
    deleteMessage: {
      // its author, the chat's Admins, or a service-wide Admin grant
      access: { service: "Admin", entry: "Admin" },
      handler: async ({ input, db }) => {
        await db.message.delete({ where: { id: input.id }, select: { id: true } });
        return { id: input.id, deleted: true as const };
      },
    },
    ...admin.handlers(messageContract, { displayName: "Messages" }),
  },
});
