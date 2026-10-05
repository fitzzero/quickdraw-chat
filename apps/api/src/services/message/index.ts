import { admin, anyOf, inherit, owner } from "@fitzzero/quickdraw-core/server";
import type { Prisma } from "@project/db";
import { chatContract, messageContract } from "@project/shared";
import { qd } from "../../quickdraw.js";
import { notifyNewMessage } from "../push-subscription/index.js";

/**
 * A message is gone: when it was its chat's latest, the chat's latest
 * activity (`Chat.lastMessageAt`, the myChats order) moves back to the
 * latest message left, or to the chat's creation. In the delete's
 * transaction, through its tracked client.
 */
async function messageDeleted(
  tx: Prisma.TransactionClient,
  chatId: string,
  createdAt: Date,
): Promise<void> {
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: { lastMessageAt: true, createdAt: true },
  });
  // a message older than the chat's latest leaves it as it is
  if (chat === null || chat.lastMessageAt > createdAt) return;
  const latest = await tx.message.findFirst({
    where: { chatId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  await tx.chat.update({
    where: { id: chatId },
    data: { lastMessageAt: latest?.createdAt ?? chat.createdAt },
    select: { id: true },
  });
}

/**
 * Messages: access inherited from the chat a message belongs to, which is
 * also what opens a chat's `byChat` history (its anchor), so everyone who may
 * read the chat sees every message in it, and nobody else does. The author
 * holds Admin on their own messages on top (`owner("userId")`), so they may
 * delete them.
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
      // a member of the chat, at Read or above: the chat's policy decides
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
    // quickdraw: hand-written because it answers { id, deleted } as the chat window expects, and moves the chat's latest activity back when its latest message goes; the read/write kit's delete answers null
    deleteMessage: {
      // its author, the chat's Admins, or a service-wide Admin grant
      access: { service: "Admin", entry: "Admin" },
      handler: async ({ input, db }) => {
        await db.$transaction(async (tx) => {
          const deleted = await tx.message.delete({
            where: { id: input.id },
            select: { chatId: true, createdAt: true },
          });
          await messageDeleted(tx, deleted.chatId, deleted.createdAt);
        });
        return { id: input.id, deleted: true as const };
      },
    },
    ...admin.handlers(messageContract, {
      displayName: "Messages",
      // a message the admin screens delete moves its chat's activity back too
      onWrite: async ({ method, before }, _ctx, tx: Prisma.TransactionClient) => {
        if (method === "adminDelete" && before !== undefined) {
          await messageDeleted(tx, before.chatId, new Date(before.createdAt));
        }
      },
    }),
  },
});
