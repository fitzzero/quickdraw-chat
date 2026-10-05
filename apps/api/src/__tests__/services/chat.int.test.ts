import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { describeAccessMatrix, eventFrames } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { chatContract, type ChatMemberDTO } from "@project/shared";
import { chatService } from "../../services/chat/index.js";
import {
  startTestApp,
  subscribeEntity,
  subscribeScope,
  type ApiConnection,
  type ApiTestApp,
} from "../utils/app.js";
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
  app.frames.clear();
});

/** An in-process caller acting as the user, with their stored grants. */
function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

async function membership(chatId: string, userId: string): Promise<{ level: string } | null> {
  return await testPrisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { level: true },
  });
}

/** The code a call failed with. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "allow";
  } catch (error) {
    return error instanceof QuickdrawError ? error.code : String(error);
  }
}

describe("ChatService", () => {
  it("creates a chat with the caller as its Admin", async () => {
    const result = await as(users.regular.id).chatService.createChat({ title: "Test Chat" });

    expect((await membership(result.id, users.regular.id))?.level).toBe("Admin");
    const chat = await testPrisma.chat.findUniqueOrThrow({ where: { id: result.id } });
    // A new chat's activity is its creation
    expect(chat.lastMessageAt.getTime()).toBe(chat.createdAt.getTime());
  });

  it("adds the invited user, whose myChats then lists the chat", async () => {
    const admin = as(users.admin.id);
    const chat = await admin.chatService.createChat({ title: "Admin Chat" });

    const invited = await admin.chatService.inviteUser({
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });
    expect(invited.id).toBe(chat.id);

    const regular = await app.connect({ userId: users.regular.id });
    const page = await subscribeScope(regular, "chatService", "myChats", users.regular.id);
    expect(page.ok).toBe(true);
    if (!page.ok || !("items" in page)) throw new Error("expected a snapshot");
    expect((page.items as { id: string }[]).map((item) => item.id)).toContain(chat.id);
    regular.close();
  });

  it("refuses a non-member's subscription to the chat", async () => {
    const chat = await as(users.admin.id).chatService.createChat({ title: "Private" });

    // users.regular has no grants and is no member
    const regular = await app.connect({ userId: users.regular.id });
    const reply = await subscribeEntity(regular, "chatService", chat.id);
    expect(reply).toMatchObject({ ok: true, r: [{ ok: false, e: { code: "FORBIDDEN" } }] });
    regular.close();
  });

  it("lets a member at Moderate rename the chat", async () => {
    const owner = as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "Original Title" });
    const editor = await createTestUser();
    await owner.chatService.inviteUser({ id: chat.id, userId: editor.id, level: "Moderate" });

    const updated = await as(editor.id).chatService.updateTitle({
      id: chat.id,
      title: "Updated Title",
    });
    expect(updated.title).toBe("Updated Title");
  });

  it("lets a member leave", async () => {
    const admin = as(users.admin.id);
    const chat = await admin.chatService.createChat({ title: "Test Chat" });
    await admin.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const left = await as(users.regular.id).chatService.leaveChat({ id: chat.id });
    expect(left.id).toBe(chat.id);
    expect(await membership(chat.id, users.regular.id)).toBeNull();
  });

  it("deletes a chat for its Admin", async () => {
    const owner = as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "To Delete" });

    const result = await owner.chatService.deleteChat({ id: chat.id });
    expect(result).toEqual({ id: chat.id, deleted: true });
    expect(await testPrisma.chat.findUnique({ where: { id: chat.id } })).toBeNull();
  });

  it("removes a member", async () => {
    const admin = as(users.admin.id);
    const chat = await admin.chatService.createChat({ title: "Test Chat" });
    await admin.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    expect(await membership(chat.id, users.regular.id)).not.toBeNull();

    const removed = await admin.chatService.removeUser({ id: chat.id, userId: users.regular.id });
    expect(removed.id).toBe(chat.id);
    expect(await membership(chat.id, users.regular.id)).toBeNull();
  });

  it("refuses an invite above the inviter's own level", async () => {
    const owner = as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "Levels" });
    const moderatorMember = await createTestUser();
    const newcomer = await createTestUser();
    await owner.chatService.inviteUser({
      id: chat.id,
      userId: moderatorMember.id,
      level: "Moderate",
    });

    const asModerator = as(moderatorMember.id);
    expect(
      await codeOf(
        asModerator.chatService.inviteUser({ id: chat.id, userId: newcomer.id, level: "Admin" }),
      ),
    ).toBe("FORBIDDEN");
    // ...nor raise themself
    expect(
      await codeOf(
        asModerator.chatService.inviteUser({
          id: chat.id,
          userId: moderatorMember.id,
          level: "Admin",
        }),
      ),
    ).toBe("FORBIDDEN");
    await asModerator.chatService.inviteUser({
      id: chat.id,
      userId: newcomer.id,
      level: "Moderate",
    });
    expect((await membership(chat.id, newcomer.id))?.level).toBe("Moderate");
  });

  it("answers user_not_found when inviting an unknown name", async () => {
    const owner = as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "By Name" });
    const unknown = await owner.chatService.inviteByName({
      chatId: chat.id,
      userName: "Nobody At All",
      level: "Read",
    });
    expect(unknown).toEqual({ error: "user_not_found" });

    await owner.chatService.inviteByName({
      chatId: chat.id,
      userName: "Admin User",
      level: "Read",
    });
    expect((await membership(chat.id, users.admin.id))?.level).toBe("Read");
  });
});

describe("ChatService live updates", () => {
  it("sends a rename to the chat's subscribed members", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Original Title" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const member = await app.connect({ userId: users.regular.id });
    expect(await subscribeEntity(member, "chatService", chat.id)).toMatchObject({
      ok: true,
      r: [{ ok: true, d: { id: chat.id, title: "Original Title" } }],
    });
    app.frames.clear();

    await owner.chatService.updateTitle({ id: chat.id, title: "Updated Title" });

    const frame = await app.frames.waitFor({ event: "qd:e", userId: users.regular.id });
    expect(frame.data).toMatchObject({
      s: "chatService",
      id: chat.id,
      d: { title: "Updated Title" },
    });
    member.close();
  });

  it("sends a deletion to the chat's subscribed members", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "To Be Deleted" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const member = await app.connect({ userId: users.regular.id });
    await subscribeEntity(member, "chatService", chat.id);
    app.frames.clear();

    await owner.chatService.deleteChat({ id: chat.id });

    const frame = await app.frames.waitFor({ event: "qd:e", userId: users.regular.id });
    expect(frame.data).toMatchObject({ t: "r", s: "chatService", id: chat.id });
    member.close();
  });
});

describe("ChatService member updates (memberUpdate, to the roster's room)", () => {
  /** The memberUpdate frames one socket received for a chat. */
  function updatesTo(connection: ApiConnection, chatId: string): readonly unknown[] {
    return app.frames({
      ...eventFrames(chatContract, "memberUpdate", (update) => update.chatId === chatId),
      socketId: connection.socket.id,
    });
  }

  /** The next memberUpdate one socket gets for a chat: its members after the change. */
  async function nextMemberUpdate(
    connection: ApiConnection,
    chatId: string,
  ): Promise<{ chatId: string; members: readonly ChatMemberDTO[] }> {
    const { data } = await app.frames.waitFor({
      ...eventFrames(chatContract, "memberUpdate", (update) => update.chatId === chatId),
      socketId: connection.socket.id,
    });
    return data[2];
  }

  /** A socket showing the chat's members: it read the roster, which joins the chat's room. */
  async function showingRoster(userId: string, chatId: string): Promise<ApiConnection> {
    const connection = await app.connect({ userId });
    await connection.call.chatService.getChatMembers({ chatId });
    return connection;
  }

  /** Lets any frame the steps before set off land. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
  }

  it("sends an invite's roster to the sockets showing it, and to no other", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    const viewer = await showingRoster(users.moderator.id, chat.id);
    // the same member's other socket, not showing the roster
    const elsewhere = await app.connect({ userId: users.moderator.id });
    app.frames.clear();

    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const update = await nextMemberUpdate(viewer, chat.id);
    // owner, moderator, regular
    expect(update.members).toHaveLength(3);
    expect(update.members.find((m) => m.userId === users.regular.id)?.user.name).toBe(
      "Regular User",
    );
    await settle();
    expect(updatesTo(elsewhere, chat.id)).toHaveLength(0);
    viewer.close();
    elsewhere.close();
  });

  it("takes a removed member out of the room first: they hear nothing, then or after", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const remaining = await showingRoster(users.moderator.id, chat.id);
    const removed = await showingRoster(users.regular.id, chat.id);
    app.frames.clear();

    await owner.chatService.removeUser({ id: chat.id, userId: users.regular.id });

    const update = await nextMemberUpdate(remaining, chat.id);
    expect(update.members).toHaveLength(2);
    expect(update.members.some((m) => m.userId === users.regular.id)).toBe(false);
    // ...and a later change: the removed socket is out of the room
    const newcomer = await createTestUser({ name: "Newcomer" });
    await owner.chatService.inviteUser({ id: chat.id, userId: newcomer.id, level: "Read" });
    await nextMemberUpdate(remaining, chat.id);
    await settle();
    expect(updatesTo(removed, chat.id)).toHaveLength(0);
    remaining.close();
    removed.close();
  });

  it("tells the remaining viewers when a user leaves, and not the one who left", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const remaining = await showingRoster(users.moderator.id, chat.id);
    const leaving = await showingRoster(users.regular.id, chat.id);
    app.frames.clear();

    await leaving.call.chatService.leaveChat({ id: chat.id });

    const update = await nextMemberUpdate(remaining, chat.id);
    expect(update.members).toHaveLength(2);
    expect(update.members.some((m) => m.userId === users.regular.id)).toBe(false);
    await settle();
    expect(updatesTo(leaving, chat.id)).toHaveLength(0);
    remaining.close();
    leaving.close();
  });

  it("keeps a socket in the roster room of the chat it showed last", async () => {
    const owner = as(users.admin.id);
    const first = await owner.chatService.createChat({
      title: "First",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const second = await owner.chatService.createChat({
      title: "Second",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const viewer = await showingRoster(users.regular.id, first.id);
    await viewer.call.chatService.getChatMembers({ chatId: second.id });
    app.frames.clear();

    await owner.chatService.inviteUser({ id: first.id, userId: users.moderator.id, level: "Read" });
    await owner.chatService.inviteUser({
      id: second.id,
      userId: users.moderator.id,
      level: "Read",
    });

    await nextMemberUpdate(viewer, second.id);
    await settle();
    expect(updatesTo(viewer, first.id)).toHaveLength(0);
    viewer.close();
  });

  it("answers the roster to a caller without a socket too", async () => {
    const chat = await as(users.admin.id).chatService.createChat({ title: "Over HTTP" });
    const roster = await as(users.admin.id).chatService.getChatMembers({ chatId: chat.id });
    expect(roster.map((member) => member.userId)).toEqual([users.admin.id]);
  });
});

describe("ChatService permission cascade (updateTitle needs Moderate)", () => {
  it("allows a service-wide Moderate grant without membership", async () => {
    // users.moderator holds chatService: Moderate
    const chat = await as(users.admin.id).chatService.createChat({ title: "Original" });
    const updated = await as(users.moderator.id).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Service Moderate",
    });
    expect(updated.title).toBe("Updated by Service Moderate");
  });

  it("allows a member at Moderate", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Original" });
    await owner.chatService.inviteUser({
      id: chat.id,
      userId: users.regular.id,
      level: "Moderate",
    });
    const updated = await as(users.regular.id).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Entry Moderate",
    });
    expect(updated.title).toBe("Updated by Entry Moderate");
  });

  it("allows a service-wide Admin grant (above Moderate)", async () => {
    const chat = await as(users.regular.id).chatService.createChat({ title: "Original" });
    const updated = await as(users.admin.id).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Service Admin",
    });
    expect(updated.title).toBe("Updated by Service Admin");
  });

  it("refuses a member at Read", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Original Title" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const reader = as(users.regular.id);
    expect(
      await codeOf(reader.chatService.updateTitle({ id: chat.id, title: "Unauthorized" })),
    ).toBe("FORBIDDEN");
    const stored = await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(stored.title).toBe("Original Title");
  });

  it("refuses a non-member", async () => {
    const chat = await as(users.admin.id).chatService.createChat({ title: "Original Title" });
    const stranger = as(users.regular.id);
    expect(
      await codeOf(stranger.chatService.updateTitle({ id: chat.id, title: "Unauthorized" })),
    ).toBe("FORBIDDEN");
  });
});

describe("ChatService membership rules (the sharing kit's three)", () => {
  /** A chat with `owner` as its one Admin and `mod` at Moderate. */
  async function chatWithModerator(): Promise<{ chatId: string; owner: string; mod: string }> {
    const owner = await createTestUser({ name: "Owner" });
    const mod = await createTestUser({ name: "Mod" });
    const chat = await as(owner.id).chatService.createChat({ title: "Levels" });
    await as(owner.id).chatService.inviteUser({ id: chat.id, userId: mod.id, level: "Moderate" });
    return { chatId: chat.id, owner: owner.id, mod: mod.id };
  }

  async function adminsOf(chatId: string): Promise<number> {
    return await testPrisma.chatMember.count({ where: { chatId, level: "Admin" } });
  }

  it("refuses a Moderate demoting the chat's Admin, then removing them (COUP)", async () => {
    const { chatId, owner, mod } = await chatWithModerator();

    expect(
      await codeOf(as(mod).chatService.inviteUser({ id: chatId, userId: owner, level: "Read" })),
    ).toBe("FORBIDDEN");
    expect((await membership(chatId, owner))?.level).toBe("Admin");
    expect(await codeOf(as(mod).chatService.removeUser({ id: chatId, userId: owner }))).toBe(
      "FORBIDDEN",
    );
    expect(await adminsOf(chatId)).toBe(1);
  });

  it("refuses removing the last Admin, and the last Admin leaving (REMOVE-ADMIN)", async () => {
    const { chatId, owner, mod } = await chatWithModerator();
    expect(await codeOf(as(mod).chatService.removeUser({ id: chatId, userId: owner }))).toBe(
      "FORBIDDEN",
    );
    // the chat's Admin removing themself, or leaving: the chat keeps its Admin
    expect(await codeOf(as(owner).chatService.removeUser({ id: chatId, userId: owner }))).toBe(
      "CONFLICT",
    );
    expect(await codeOf(as(owner).chatService.leaveChat({ id: chatId }))).toBe("CONFLICT");
    // a service-wide Admin grant may change anyone, but not empty the chat of Admins
    expect(
      await codeOf(as(users.admin.id).chatService.removeUser({ id: chatId, userId: owner })),
    ).toBe("CONFLICT");
    expect(await adminsOf(chatId)).toBe(1);

    // with a second Admin, the first may leave
    await as(owner).chatService.inviteUser({ id: chatId, userId: mod, level: "Admin" });
    expect(await codeOf(as(owner).chatService.leaveChat({ id: chatId }))).toBe("allow");
    expect(await adminsOf(chatId)).toBe(1);
  });

  it("refuses a Moderate changing another Moderate, and themself", async () => {
    const { chatId, mod } = await chatWithModerator();
    const otherMod = await createTestUser({ name: "Other Mod" });
    await as(mod).chatService.inviteUser({ id: chatId, userId: otherMod.id, level: "Moderate" });

    expect(
      await codeOf(
        as(mod).chatService.inviteUser({ id: chatId, userId: otherMod.id, level: "Read" }),
      ),
    ).toBe("FORBIDDEN");
    expect(await codeOf(as(mod).chatService.removeUser({ id: chatId, userId: otherMod.id }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await codeOf(as(mod).chatService.inviteUser({ id: chatId, userId: mod, level: "Read" })),
    ).toBe("FORBIDDEN");
    expect((await membership(chatId, otherMod.id))?.level).toBe("Moderate");
  });

  it("lets a Moderate manage Read members, and an Admin manage Moderates and other Admins", async () => {
    const { chatId, owner, mod } = await chatWithModerator();
    const reader = await createTestUser({ name: "Reader" });
    const coAdmin = await createTestUser({ name: "Co-Admin" });
    await as(mod).chatService.inviteUser({ id: chatId, userId: reader.id, level: "Read" });
    await as(mod).chatService.removeUser({ id: chatId, userId: reader.id });
    expect(await membership(chatId, reader.id)).toBeNull();

    await as(owner).chatService.inviteUser({ id: chatId, userId: coAdmin.id, level: "Admin" });
    await as(owner).chatService.inviteUser({ id: chatId, userId: mod, level: "Read" });
    expect((await membership(chatId, mod))?.level).toBe("Read");
    // an Admin manages another Admin
    await as(owner).chatService.removeUser({ id: chatId, userId: coAdmin.id });
    expect(await membership(chatId, coAdmin.id)).toBeNull();
  });

  it("answers NOT_FOUND for removing a non-member and for inviting an unknown user", async () => {
    const { chatId, owner } = await chatWithModerator();
    const stranger = await createTestUser({ name: "Not In It" });
    expect(
      await codeOf(as(owner).chatService.removeUser({ id: chatId, userId: stranger.id })),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        as(owner).chatService.inviteUser({
          id: chatId,
          userId: "ckzzzzzzzzzzzzzzzzzzzzzzz",
          level: "Read",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("ChatService access matrix", () => {
  it("admits each method's callers", async () => {
    // Users without service grants: the chat's membership alone decides
    const [owner, moderator, member, stranger, extra] = await Promise.all([
      createTestUser({ name: "Owner" }),
      createTestUser({ name: "Moderator" }),
      createTestUser({ name: "Member" }),
      createTestUser({ name: "Stranger" }),
      createTestUser({ name: "Extra" }),
    ]);
    /** A chat with the owner as its one Admin, the moderator and the member. */
    const newChat = async (): Promise<string> => {
      const chat = await as(owner.id).chatService.createChat({
        title: "Matrix",
        members: [
          { userId: moderator.id, level: "Moderate" },
          { userId: member.id, level: "Read" },
        ],
      });
      return chat.id;
    };
    const chatId = await newChat();
    /** An invite of the extra user at Admin, into a chat of its own. */
    const inviteAtAdmin = async (): Promise<{ id: string; userId: string; level: "Admin" }> => ({
      id: await newChat(),
      userId: extra.id,
      level: "Admin",
    });
    const principals = {
      owner: { userId: owner.id },
      moderator: { userId: moderator.id },
      member: { userId: member.id },
      stranger: { userId: stranger.id },
    };

    await describeAccessMatrix(app, {
      service: chatService,
      principals,
      cases: [
        {
          method: "createChat",
          input: { title: "Mine" },
          allow: ["owner", "moderator", "member", "stranger"],
        },
        { method: "getChatMembers", input: { chatId }, allow: ["owner", "moderator", "member"] },
        {
          method: "updateTitle",
          input: { id: chatId, title: "Renamed" },
          allow: ["owner", "moderator"],
        },
        {
          method: "deleteChat",
          input: async () => ({ id: await newChat() }),
          allow: ["owner"],
        },
        {
          method: "inviteUser",
          input: { id: chatId, userId: extra.id, level: "Read" },
          allow: ["owner", "moderator"],
        },
        {
          label: "inviteUser (at Admin)",
          method: "inviteUser",
          input: inviteAtAdmin,
          allow: ["owner"],
        },
        {
          method: "inviteByName",
          input: { chatId, userName: "Extra", level: "Read" },
          allow: ["owner", "moderator"],
        },
        {
          label: "removeUser (a Read member)",
          method: "removeUser",
          input: async () => ({ id: await newChat(), userId: member.id }),
          allow: ["owner", "moderator"],
        },
        {
          label: "removeUser (the chat's last Admin)",
          method: "removeUser",
          input: async () => ({ id: await newChat(), userId: owner.id }),
          expect: { owner: "CONFLICT" },
        },
        {
          method: "leaveChat",
          input: async () => ({ id: await newChat() }),
          allow: ["moderator", "member"],
          expect: { owner: "CONFLICT" },
        },
        { method: "adminList", input: {}, allow: [] },
      ],
    });
  });
});
