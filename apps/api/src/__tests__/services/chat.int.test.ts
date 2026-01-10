import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck, waitForEvent } from "../utils/socket.js";

describe("ChatService Integration", () => {
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

  it("should create a chat and become admin", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const result = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "chatService:createChat",
      { title: "Test Chat" }
    );

    expect(result.id).toBeDefined();

    // Verify membership
    const member = await testPrisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: result.id,
          userId: users.regular.id,
        },
      },
    });

    expect(member).toBeDefined();
    expect(member?.level).toBe("Admin");

    client.close();
  });

  it("should allow admin to invite users", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const regular = await connectAsUser(port, users.regular.id);

    // Create chat as admin
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Admin Chat" }
    );

    // Invite regular user
    const inviteResult = await emitWithAck<
      { id: string; userId: string; level: string },
      { id: string }
    >(admin, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    expect(inviteResult.id).toBe(chat.id);

    // Regular user should now see the chat
    const myChats = await emitWithAck<
      { page?: number },
      { id: string; title: string }[]
    >(regular, "chatService:listMyChats", {});

    expect(myChats.some((c) => c.id === chat.id)).toBe(true);

    admin.close();
    regular.close();
  });

  it("should deny non-members from subscribing", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const regular = await connectAsUser(port, users.regular.id);

    // Create private chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Private Chat" }
    );
    admin.close();

    // Regular user tries to subscribe (not invited)
    await expect(
      emitWithAck(regular, "chatService:subscribe", { entryId: chat.id })
    ).rejects.toThrow();

    regular.close();
  });

  it("should allow members to update title if Moderate access", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const moderator = await connectAsUser(port, users.moderator.id);

    // Create chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Original Title" }
    );

    // Invite moderator with Moderate access
    await emitWithAck(admin, "chatService:inviteUser", {
      id: chat.id,
      userId: users.moderator.id,
      level: "Moderate",
    });

    // Moderator updates title
    const updated = await emitWithAck<
      { id: string; title: string },
      { id: string; title: string } | null
    >(moderator, "chatService:updateTitle", {
      id: chat.id,
      title: "Updated Title",
    });

    expect(updated?.title).toBe("Updated Title");

    admin.close();
    moderator.close();
  });

  it("should allow user to leave chat", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const regular = await connectAsUser(port, users.regular.id);

    // Create chat and invite
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Test Chat" }
    );
    await emitWithAck(admin, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Regular user leaves
    const leaveResult = await emitWithAck<{ id: string }, { id: string }>(
      regular,
      "chatService:leaveChat",
      { id: chat.id }
    );

    expect(leaveResult.id).toBe(chat.id);

    // Verify membership removed
    const member = await testPrisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: chat.id,
          userId: users.regular.id,
        },
      },
    });

    expect(member).toBeNull();

    admin.close();
    regular.close();
  });

  it("should delete chat with Admin access", async () => {
    const admin = await connectAsUser(port, users.admin.id);

    // Create chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "To Delete" }
    );

    // Delete it
    const deleteResult = await emitWithAck<
      { id: string },
      { id: string; deleted: true }
    >(admin, "chatService:deleteChat", { id: chat.id });

    expect(deleteResult.deleted).toBe(true);

    // Verify deleted
    const dbChat = await testPrisma.chat.findUnique({
      where: { id: chat.id },
    });
    expect(dbChat).toBeNull();

    admin.close();
  });

  it("should allow admin to remove user from chat", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const regular = await connectAsUser(port, users.regular.id);

    // Create chat and invite regular user
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      admin,
      "chatService:createChat",
      { title: "Test Chat" }
    );
    await emitWithAck(admin, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Verify user is a member
    let member = await testPrisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: chat.id,
          userId: users.regular.id,
        },
      },
    });
    expect(member).not.toBeNull();

    // Admin removes user
    const removeResult = await emitWithAck<
      { id: string; userId: string },
      { id: string }
    >(admin, "chatService:removeUser", {
      id: chat.id,
      userId: users.regular.id,
    });

    expect(removeResult.id).toBe(chat.id);

    // Verify membership removed
    member = await testPrisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: chat.id,
          userId: users.regular.id,
        },
      },
    });
    expect(member).toBeNull();

    admin.close();
    regular.close();
  });

  it("should propagate updates to all subscribed members in real-time", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    // Owner creates chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Original Title" }
    );

    // Invite member
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Member subscribes to the chat
    await emitWithAck(member, "chatService:subscribe", { entryId: chat.id });

    // Set up listener for update BEFORE owner updates
    const updatePromise = waitForEvent<{ id: string; title: string }>(
      member,
      `chatService:update:${chat.id}`,
      3000
    );

    // Owner updates title
    await emitWithAck(owner, "chatService:updateTitle", {
      id: chat.id,
      title: "Updated Title",
    });

    // Member should receive the update
    const update = await updatePromise;
    expect(update.title).toBe("Updated Title");

    owner.close();
    member.close();
  });

  it("should propagate delete event to subscribed members", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    // Owner creates chat and invites member
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "To Be Deleted" }
    );
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Member subscribes
    await emitWithAck(member, "chatService:subscribe", { entryId: chat.id });

    // Set up listener for delete event
    const deletePromise = waitForEvent<{ id: string; deleted: boolean }>(
      member,
      `chatService:update:${chat.id}`,
      3000
    );

    // Owner deletes chat
    await emitWithAck(owner, "chatService:deleteChat", { id: chat.id });

    // Member should receive delete notification
    const deleteEvent = await deletePromise;
    expect(deleteEvent.id).toBe(chat.id);
    expect(deleteEvent.deleted).toBe(true);

    owner.close();
    member.close();
  });
});
