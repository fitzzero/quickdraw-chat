import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { describeAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { MessageDTO } from "@project/shared";
import { messageService } from "../../services/message/index.js";
import { startTestApp, subscribeScope, type ApiTestApp } from "../utils/app.js";
import { createTestChat, createTestMessage } from "../factories/chat-factory.js";
import { createTestUser } from "../factories/user-factory.js";

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
});

function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "allow";
  } catch (error) {
    return error instanceof QuickdrawError ? error.code : String(error);
  }
}

describe("MessageService", () => {
  it("posts a message and moves its chat's activity", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "Message Test Chat" });

    const result = await regular.messageService.postMessage({
      chatId: chat.id,
      content: "Hello, world!",
    });

    const message = await testPrisma.message.findUniqueOrThrow({ where: { id: result.id } });
    expect(message.content).toBe("Hello, world!");
    expect(message.userId).toBe(users.regular.id);
    const stored = await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(stored.lastMessageAt.getTime()).toBe(message.createdAt.getTime());
  });

  it("pages a chat's history through byChat, newest first", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "List Test Chat" });
    for (const content of ["First message", "Second message", "Third message"]) {
      await regular.messageService.postMessage({ chatId: chat.id, content });
    }

    const socket = await app.connect({ userId: users.regular.id });
    const page1 = await subscribeScope(socket, "messageService", "byChat", chat.id, { limit: 2 });
    if (!page1.ok || !("items" in page1)) throw new Error("expected a snapshot");
    const first = page1.items as MessageDTO[];
    expect(first.map((m) => m.content)).toEqual(["Third message", "Second message"]);
    expect(first[0]?.user).toEqual({ id: users.regular.id, name: "Regular User", image: null });
    expect(page1.total).toBe(3);
    expect(page1.cursor).not.toBeNull();

    const page2 = await subscribeScope(socket, "messageService", "byChat", chat.id, {
      limit: 2,
      cursor: page1.cursor ?? undefined,
    });
    if (!page2.ok || !("items" in page2)) throw new Error("expected a page");
    expect((page2.items as MessageDTO[]).map((m) => m.content)).toEqual(["First message"]);
    expect(page2.cursor).toBeNull();
    socket.close();
  });

  it("keeps the id the sender made, and answers it again CONFLICT without writing twice", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "Client ids" });
    const id = crypto.randomUUID();
    expect(
      await regular.messageService.postMessage({ id, chatId: chat.id, content: "Once" }),
    ).toEqual({ id });

    // the same send again, as a retry after a lost answer: nothing written
    expect(
      await codeOf(regular.messageService.postMessage({ id, chatId: chat.id, content: "Twice" })),
    ).toBe("CONFLICT");
    const stored = await testPrisma.message.findMany({
      where: { chatId: chat.id },
      select: { id: true, content: true },
    });
    expect(stored).toEqual([{ id, content: "Once" }]);
  });

  it("never lets a sender's id name another message: neither a server-made one nor someone else's", async () => {
    const author = await createTestUser();
    const other = await createTestUser();
    const mine = await createTestChat({ members: [{ userId: author.id }] });
    const theirs = await createTestChat({ members: [{ userId: other.id }] });

    // a server-made id is a cuid, never a UUID: refused before anything runs
    const serverMade = await createTestMessage({ chatId: theirs.id, userId: other.id });
    expect(
      await codeOf(
        as(author.id).messageService.postMessage({
          id: serverMade.id,
          chatId: mine.id,
          content: "Mine now",
        }),
      ),
    ).toBe("VALIDATION");

    // another sender's id: CONFLICT, and their message stays theirs, where it was
    const id = crypto.randomUUID();
    await as(other.id).messageService.postMessage({ id, chatId: theirs.id, content: "Theirs" });
    expect(
      await codeOf(
        as(author.id).messageService.postMessage({ id, chatId: mine.id, content: "Mine now" }),
      ),
    ).toBe("CONFLICT");
    expect(
      await testPrisma.message.findUniqueOrThrow({
        where: { id },
        select: { chatId: true, userId: true, content: true },
      }),
    ).toEqual({ chatId: theirs.id, userId: other.id, content: "Theirs" });
  });

  it("deletes a message by the id its sender made", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "Client id delete" });
    const id = crypto.randomUUID();
    await regular.messageService.postMessage({ id, chatId: chat.id, content: "Short-lived" });

    expect(await regular.messageService.deleteMessage({ id })).toEqual({ id, deleted: true });
    expect(await testPrisma.message.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses a post to a chat the caller is no member of", async () => {
    const chat = await as(users.admin.id).chatService.createChat({ title: "Private" });
    expect(
      await codeOf(
        as(users.regular.id).messageService.postMessage({
          chatId: chat.id,
          content: "Unauthorized message",
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("lets the author delete their own message", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "Delete Test Chat" });
    const message = await regular.messageService.postMessage({
      chatId: chat.id,
      content: "To be deleted",
    });

    expect(await regular.messageService.deleteMessage({ id: message.id })).toEqual({
      id: message.id,
      deleted: true,
    });
    expect(await testPrisma.message.findUnique({ where: { id: message.id } })).toBeNull();
  });

  it("lets a service-wide Admin delete any message", async () => {
    const regular = as(users.regular.id);
    const chat = await regular.chatService.createChat({ title: "Service Admin Test" });
    const message = await regular.messageService.postMessage({
      chatId: chat.id,
      content: "Regular user message",
    });

    // users.admin holds messageService: Admin and is no member of the chat
    const result = await as(users.admin.id).messageService.deleteMessage({ id: message.id });
    expect(result.deleted).toBe(true);
    expect(await testPrisma.message.findUnique({ where: { id: message.id } })).toBeNull();
  });

  it("refuses a member who is not the author", async () => {
    const author = await createTestUser();
    const reader = await createTestUser();
    const chat = await createTestChat({
      title: "Permission Test Chat",
      members: [{ userId: author.id }, { userId: reader.id, level: "Moderate" }],
    });
    const message = await createTestMessage({ chatId: chat.id, userId: author.id });

    expect(await codeOf(as(reader.id).messageService.deleteMessage({ id: message.id }))).toBe(
      "FORBIDDEN",
    );
    expect(await testPrisma.message.findUnique({ where: { id: message.id } })).not.toBeNull();
  });

  it("lets the chat's Admin delete a member's message", async () => {
    const chatAdmin = await createTestUser();
    const member = await createTestUser();
    const chat = await createTestChat({
      title: "Moderated",
      members: [{ userId: chatAdmin.id, level: "Admin" }, { userId: member.id }],
    });
    const message = await createTestMessage({ chatId: chat.id, userId: member.id });

    const result = await as(chatAdmin.id).messageService.deleteMessage({ id: message.id });
    expect(result.deleted).toBe(true);
  });

  it("moves the chat's latest activity back when its latest message is deleted", async () => {
    const author = as(users.regular.id);
    const chat = await author.chatService.createChat({ title: "Rewind" });
    const first = await author.messageService.postMessage({ chatId: chat.id, content: "first" });
    const second = await author.messageService.postMessage({ chatId: chat.id, content: "second" });
    const third = await author.messageService.postMessage({ chatId: chat.id, content: "third" });
    const createdAt = async (id: string): Promise<number> =>
      (await testPrisma.message.findUniqueOrThrow({ where: { id } })).createdAt.getTime();
    const activity = async (): Promise<number> =>
      (await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).lastMessageAt.getTime();
    const [firstAt, secondAt] = [await createdAt(first.id), await createdAt(second.id)];

    // an older message: the latest activity stays the third's
    const thirdAt = await createdAt(third.id);
    await author.messageService.deleteMessage({ id: second.id });
    expect(await activity()).toBe(thirdAt);
    // the latest message: back to the one left
    await author.messageService.deleteMessage({ id: third.id });
    expect(await activity()).toBe(firstAt);
    expect(secondAt).toBeGreaterThanOrEqual(firstAt);
    // the last one, through the admin screens: back to the chat's creation
    await as(users.admin.id).messageService.adminDelete({ id: first.id });
    const stored = await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(stored.lastMessageAt.getTime()).toBe(stored.createdAt.getTime());
  });
});

describe("MessageService access matrix", () => {
  it("admits each method's callers", async () => {
    const [author, chatAdmin, reader, stranger] = await Promise.all([
      createTestUser(),
      createTestUser(),
      createTestUser(),
      createTestUser(),
    ]);
    const chat = await createTestChat({
      title: "Matrix",
      members: [
        { userId: chatAdmin.id, level: "Admin" },
        { userId: author.id, level: "Read" },
        { userId: reader.id, level: "Read" },
      ],
    });
    // Each delete runs for real, so every cell deletes a fresh message
    const byAuthor = async (): Promise<{ id: string }> => ({
      id: (await createTestMessage({ chatId: chat.id, userId: author.id })).id,
    });
    const byReader = async (): Promise<{ id: string }> => ({
      id: (await createTestMessage({ chatId: chat.id, userId: reader.id })).id,
    });

    await describeAccessMatrix(app, {
      service: messageService,
      principals: {
        author: { userId: author.id },
        chatAdmin: { userId: chatAdmin.id },
        reader: { userId: reader.id },
        stranger: { userId: stranger.id },
      },
      cases: [
        {
          method: "postMessage",
          input: { chatId: chat.id, content: "Hi" },
          allow: ["author", "chatAdmin", "reader"],
        },
        {
          label: "deleteMessage (the author's)",
          method: "deleteMessage",
          input: byAuthor,
          allow: ["author", "chatAdmin"],
        },
        {
          label: "deleteMessage (another member's)",
          method: "deleteMessage",
          input: byReader,
          allow: ["chatAdmin", "reader"],
        },
        { method: "adminList", input: {}, allow: [] },
      ],
    });
  });
});
