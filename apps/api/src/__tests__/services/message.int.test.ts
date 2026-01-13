import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck, waitForEvent } from "../utils/socket.js";
import type { MessageDTO } from "@project/shared";

describe("MessageService Integration", () => {
  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
  });

  it("should post a message to a chat", async () => {
    const client = await connectAsUser(port, users.regular.id);

    // Create chat first
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "chatService:createChat",
      { title: "Message Test Chat" }
    );

    // Post message
    const result = await emitWithAck<
      { chatId: string; content: string },
      { id: string }
    >(client, "messageService:postMessage", {
      chatId: chat.id,
      content: "Hello, world!",
    });

    expect(result.id).toBeDefined();

    // Verify in database
    const message = await testPrisma.message.findUnique({
      where: { id: result.id },
    });

    expect(message).toBeDefined();
    expect(message?.content).toBe("Hello, world!");
    expect(message?.userId).toBe(users.regular.id);

    client.close();
  });

  it("should list messages for a chat", async () => {
    const client = await connectAsUser(port, users.regular.id);

    // Create chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "chatService:createChat",
      { title: "List Test Chat" }
    );

    // Post multiple messages
    await emitWithAck(client, "messageService:postMessage", {
      chatId: chat.id,
      content: "First message",
    });
    await emitWithAck(client, "messageService:postMessage", {
      chatId: chat.id,
      content: "Second message",
    });
    await emitWithAck(client, "messageService:postMessage", {
      chatId: chat.id,
      content: "Third message",
    });

    // List messages
    const messages = await emitWithAck<
      { chatId: string; limit?: number },
      MessageDTO[]
    >(client, "messageService:listMessages", {
      chatId: chat.id,
      limit: 10,
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toBe("First message");
    expect(messages[2]?.content).toBe("Third message");

    client.close();
  });

  it("should deny posting to chats user is not a member of", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const regular = await connectAsUser(port, users.regular.id);

    // Admin creates private chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Private Chat" }
    );
    admin.close();

    // Regular user (not invited) tries to post
    await expect(
      emitWithAck(regular, "messageService:postMessage", {
        chatId: chat.id,
        content: "Unauthorized message",
      })
    ).rejects.toThrow();

    regular.close();
  });

  it("should allow owner to delete their own message", async () => {
    const client = await connectAsUser(port, users.regular.id);

    // Create chat and post message
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "chatService:createChat",
      { title: "Delete Test Chat" }
    );

    const message = await emitWithAck<
      { chatId: string; content: string },
      { id: string }
    >(client, "messageService:postMessage", {
      chatId: chat.id,
      content: "To be deleted",
    });

    // Delete the message
    const deleteResult = await emitWithAck<
      { id: string },
      { id: string; deleted: true }
    >(client, "messageService:deleteMessage", { id: message.id });

    expect(deleteResult.deleted).toBe(true);

    // Verify deleted
    const dbMessage = await testPrisma.message.findUnique({
      where: { id: message.id },
    });
    expect(dbMessage).toBeNull();

    client.close();
  });

  it("should allow service-level admin to delete any message", async () => {
    const regular = await connectAsUser(port, users.regular.id);
    // Admin has serviceAccess.messageService = "Admin"
    const serviceAdmin = await connectAsUser(port, users.admin.id);

    // Regular user creates chat and posts message
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      regular,
      "chatService:createChat",
      { title: "Service Admin Test" }
    );

    const message = await emitWithAck<
      { chatId: string; content: string },
      { id: string }
    >(regular, "messageService:postMessage", {
      chatId: chat.id,
      content: "Regular user message",
    });

    // Service-level admin can delete any message (regardless of chat membership)
    const deleteResult = await emitWithAck<
      { id: string },
      { id: string; deleted: true }
    >(serviceAdmin, "messageService:deleteMessage", { id: message.id });

    expect(deleteResult.deleted).toBe(true);

    // Verify deleted
    const dbMessage = await testPrisma.message.findUnique({
      where: { id: message.id },
    });
    expect(dbMessage).toBeNull();

    regular.close();
    serviceAdmin.close();
  });
});

describe("MessageService Integration - Socket Room Updates", () => {
  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
  });

  it("should broadcast new message to all chat subscribers", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    // Owner creates chat and invites member
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Broadcast Test Chat" }
    );
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Both users subscribe to the chat (so they join the room)
    await emitWithAck(owner, "chatService:subscribe", { entryId: chat.id });
    await emitWithAck(member, "chatService:subscribe", { entryId: chat.id });

    // Set up listener for chat:message event BEFORE posting
    const messagePromise = waitForEvent<MessageDTO>(
      member,
      "chat:message",
      3000
    );

    // Owner posts a message
    await emitWithAck(owner, "messageService:postMessage", {
      chatId: chat.id,
      content: "Hello from owner!",
    });

    // Member should receive the message broadcast
    const receivedMessage = await messagePromise;
    expect(receivedMessage.content).toBe("Hello from owner!");
    expect(receivedMessage.userId).toBe(users.admin.id);
    expect(receivedMessage.chatId).toBe(chat.id);
    expect(receivedMessage.user).toBeDefined();
    expect(receivedMessage.user?.name).toBe("Admin User");

    owner.close();
    member.close();
  });
});

describe("MessageService Integration - Permission Cascade", () => {
  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
  });

  it("should deny non-owner without service access from deleting message", async () => {
    const messageOwner = await connectAsUser(port, users.regular.id);
    const otherMember = await connectAsUser(port, users.moderator.id);

    // Message owner creates chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      messageOwner,
      "chatService:createChat",
      { title: "Permission Test Chat" }
    );

    // Invite other member (who has no service-level messageService access)
    await emitWithAck(messageOwner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.moderator.id,
      level: "Read",
    });

    // Message owner posts a message
    const message = await emitWithAck<
      { chatId: string; content: string },
      { id: string }
    >(messageOwner, "messageService:postMessage", {
      chatId: chat.id,
      content: "Only I can delete this",
    });

    // Other member (not message owner, no service-level access) tries to delete
    await expect(
      emitWithAck(otherMember, "messageService:deleteMessage", {
        id: message.id,
      })
    ).rejects.toThrow();

    // Verify message was NOT deleted
    const dbMessage = await testPrisma.message.findUnique({
      where: { id: message.id },
    });
    expect(dbMessage).not.toBeNull();
    expect(dbMessage?.content).toBe("Only I can delete this");

    messageOwner.close();
    otherMember.close();
  });
});
