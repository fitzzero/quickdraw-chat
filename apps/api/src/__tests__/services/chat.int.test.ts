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

describe("ChatService Integration - Socket Room Updates", () => {
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

  it("should emit member update when user is invited", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const existingMember = await connectAsUser(port, users.moderator.id);

    // Owner creates chat
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Test Chat" }
    );

    // Add existing member first
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.moderator.id,
      level: "Read",
    });

    // Existing member subscribes to the chat
    await emitWithAck(existingMember, "chatService:subscribe", {
      entryId: chat.id,
    });

    // Set up listener for member update BEFORE inviting new user
    const memberUpdatePromise = waitForEvent<{
      members: { id: string; userId: string; level: string }[];
    }>(existingMember, "chat:memberUpdate", 3000);

    // Owner invites another user
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Existing member should receive the member update
    const memberUpdate = await memberUpdatePromise;
    expect(memberUpdate.members).toBeDefined();
    expect(memberUpdate.members.length).toBe(3); // owner, moderator, regular
    expect(
      memberUpdate.members.some((m) => m.userId === users.regular.id)
    ).toBe(true);

    owner.close();
    existingMember.close();
  });

  it("should emit member update when user is removed", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const remainingMember = await connectAsUser(port, users.moderator.id);

    // Owner creates chat and invites two members
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Test Chat" }
    );
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.moderator.id,
      level: "Read",
    });
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Remaining member subscribes
    await emitWithAck(remainingMember, "chatService:subscribe", {
      entryId: chat.id,
    });

    // Set up listener for member update BEFORE removing user
    const memberUpdatePromise = waitForEvent<{
      members: { id: string; userId: string; level: string }[];
    }>(remainingMember, "chat:memberUpdate", 3000);

    // Owner removes regular user
    await emitWithAck(owner, "chatService:removeUser", {
      id: chat.id,
      userId: users.regular.id,
    });

    // Remaining member should receive the member update
    const memberUpdate = await memberUpdatePromise;
    expect(memberUpdate.members).toBeDefined();
    expect(memberUpdate.members.length).toBe(2); // owner, moderator (regular removed)
    expect(
      memberUpdate.members.some((m) => m.userId === users.regular.id)
    ).toBe(false);

    owner.close();
    remainingMember.close();
  });

  it("should emit member update when user leaves", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const leavingMember = await connectAsUser(port, users.regular.id);
    const remainingMember = await connectAsUser(port, users.moderator.id);

    // Owner creates chat and invites two members
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Test Chat" }
    );
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.moderator.id,
      level: "Read",
    });
    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Remaining member subscribes
    await emitWithAck(remainingMember, "chatService:subscribe", {
      entryId: chat.id,
    });

    // Set up listener for member update BEFORE user leaves
    const memberUpdatePromise = waitForEvent<{
      members: { id: string; userId: string; level: string }[];
    }>(remainingMember, "chat:memberUpdate", 3000);

    // Regular user leaves
    await emitWithAck(leavingMember, "chatService:leaveChat", {
      id: chat.id,
    });

    // Remaining member should receive the member update
    const memberUpdate = await memberUpdatePromise;
    expect(memberUpdate.members).toBeDefined();
    expect(memberUpdate.members.length).toBe(2); // owner, moderator (regular left)
    expect(
      memberUpdate.members.some((m) => m.userId === users.regular.id)
    ).toBe(false);

    owner.close();
    leavingMember.close();
    remainingMember.close();
  });
});

describe("ChatService Integration - Permission Cascade", () => {
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

  // Test method: updateTitle requires "Moderate" access level
  // Permission cascade: Service-level > Entry-level > Deny

  it("should allow service-level Moderate access to updateTitle (not a member)", async () => {
    // users.moderator has serviceAccess.chatService = "Moderate"
    const chatOwner = await connectAsUser(port, users.admin.id);
    const serviceModerator = await connectAsUser(port, users.moderator.id);

    // Chat owner creates chat (moderator is NOT invited)
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      chatOwner,
      "chatService:createChat",
      { title: "Original Title" }
    );

    // Service-level Moderate can update title even without being a member
    const updated = await emitWithAck<
      { id: string; title: string },
      { id: string; title: string } | null
    >(serviceModerator, "chatService:updateTitle", {
      id: chat.id,
      title: "Updated by Service Moderate",
    });

    expect(updated?.title).toBe("Updated by Service Moderate");

    chatOwner.close();
    serviceModerator.close();
  });

  it("should allow entry-level Moderate access to updateTitle", async () => {
    const chatOwner = await connectAsUser(port, users.admin.id);
    const entryModerator = await connectAsUser(port, users.regular.id);

    // Chat owner creates chat and invites regular user with Moderate access
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      chatOwner,
      "chatService:createChat",
      { title: "Original Title" }
    );
    await emitWithAck(chatOwner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Moderate",
    });

    // Entry-level Moderate can update title
    const updated = await emitWithAck<
      { id: string; title: string },
      { id: string; title: string } | null
    >(entryModerator, "chatService:updateTitle", {
      id: chat.id,
      title: "Updated by Entry Moderate",
    });

    expect(updated?.title).toBe("Updated by Entry Moderate");

    chatOwner.close();
    entryModerator.close();
  });

  it("should allow service-level Admin to updateTitle (higher level sufficient)", async () => {
    // users.admin has serviceAccess.chatService = "Admin" which is higher than Moderate
    const chatOwner = await connectAsUser(port, users.regular.id);
    const serviceAdmin = await connectAsUser(port, users.admin.id);

    // Regular user creates chat (admin is NOT invited)
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      chatOwner,
      "chatService:createChat",
      { title: "Original Title" }
    );

    // Service-level Admin can update title (Admin > Moderate)
    const updated = await emitWithAck<
      { id: string; title: string },
      { id: string; title: string } | null
    >(serviceAdmin, "chatService:updateTitle", {
      id: chat.id,
      title: "Updated by Service Admin",
    });

    expect(updated?.title).toBe("Updated by Service Admin");

    chatOwner.close();
    serviceAdmin.close();
  });

  it("should deny entry-level Read access from updateTitle", async () => {
    const chatOwner = await connectAsUser(port, users.admin.id);
    const readOnlyMember = await connectAsUser(port, users.regular.id);

    // Chat owner creates chat and invites regular user with Read-only access
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      chatOwner,
      "chatService:createChat",
      { title: "Original Title" }
    );
    await emitWithAck(chatOwner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Read-only member cannot update title (Read < Moderate)
    await expect(
      emitWithAck(readOnlyMember, "chatService:updateTitle", {
        id: chat.id,
        title: "Unauthorized Update",
      })
    ).rejects.toThrow();

    // Verify title was not changed
    const dbChat = await testPrisma.chat.findUnique({
      where: { id: chat.id },
    });
    expect(dbChat?.title).toBe("Original Title");

    chatOwner.close();
    readOnlyMember.close();
  });

  it("should deny non-member from updateTitle", async () => {
    const chatOwner = await connectAsUser(port, users.admin.id);
    const nonMember = await connectAsUser(port, users.regular.id);

    // Chat owner creates chat (regular user is NOT invited)
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      chatOwner,
      "chatService:createChat",
      { title: "Original Title" }
    );

    // Non-member cannot update title
    await expect(
      emitWithAck(nonMember, "chatService:updateTitle", {
        id: chat.id,
        title: "Unauthorized Update",
      })
    ).rejects.toThrow();

    // Verify title was not changed
    const dbChat = await testPrisma.chat.findUnique({
      where: { id: chat.id },
    });
    expect(dbChat?.title).toBe("Original Title");

    chatOwner.close();
    nonMember.close();
  });
});
