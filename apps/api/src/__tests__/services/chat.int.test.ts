import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { describeAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { ChatMemberDTO } from "@project/shared";
import { chatService } from "../../services/chat/index.js";
import {
  principalOf,
  startTestApp,
  subscribeEntity,
  subscribeScope,
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
async function as(userId: string): Promise<ReturnType<ApiTestApp["as"]>> {
  return app.as(await principalOf(userId));
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
    const result = await (
      await as(users.regular.id)
    ).chatService.createChat({ title: "Test Chat" });

    expect((await membership(result.id, users.regular.id))?.level).toBe("Admin");
    const chat = await testPrisma.chat.findUniqueOrThrow({ where: { id: result.id } });
    // A new chat's activity is its creation
    expect(chat.lastMessageAt.getTime()).toBe(chat.createdAt.getTime());
  });

  it("adds the invited user, whose myChats then lists the chat", async () => {
    const admin = await as(users.admin.id);
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
    const chat = await (await as(users.admin.id)).chatService.createChat({ title: "Private" });

    // users.regular has no grants and is no member
    const regular = await app.connect({ userId: users.regular.id });
    const reply = await subscribeEntity(regular, "chatService", chat.id);
    expect(reply).toMatchObject({ ok: true, r: [{ ok: false, e: { code: "FORBIDDEN" } }] });
    regular.close();
  });

  it("lets a member at Moderate rename the chat", async () => {
    const owner = await as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "Original Title" });
    const editor = await createTestUser();
    await owner.chatService.inviteUser({ id: chat.id, userId: editor.id, level: "Moderate" });

    const updated = await (
      await as(editor.id)
    ).chatService.updateTitle({
      id: chat.id,
      title: "Updated Title",
    });
    expect(updated.title).toBe("Updated Title");
  });

  it("lets a member leave", async () => {
    const admin = await as(users.admin.id);
    const chat = await admin.chatService.createChat({ title: "Test Chat" });
    await admin.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const left = await (await as(users.regular.id)).chatService.leaveChat({ id: chat.id });
    expect(left.id).toBe(chat.id);
    expect(await membership(chat.id, users.regular.id)).toBeNull();
  });

  it("deletes a chat for its Admin", async () => {
    const owner = await as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "To Delete" });

    const result = await owner.chatService.deleteChat({ id: chat.id });
    expect(result).toEqual({ id: chat.id, deleted: true });
    expect(await testPrisma.chat.findUnique({ where: { id: chat.id } })).toBeNull();
  });

  it("removes a member", async () => {
    const admin = await as(users.admin.id);
    const chat = await admin.chatService.createChat({ title: "Test Chat" });
    await admin.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    expect(await membership(chat.id, users.regular.id)).not.toBeNull();

    const removed = await admin.chatService.removeUser({ id: chat.id, userId: users.regular.id });
    expect(removed.id).toBe(chat.id);
    expect(await membership(chat.id, users.regular.id)).toBeNull();
  });

  it("refuses an invite above the inviter's own level", async () => {
    const owner = await as(users.regular.id);
    const chat = await owner.chatService.createChat({ title: "Levels" });
    const moderatorMember = await createTestUser();
    const newcomer = await createTestUser();
    await owner.chatService.inviteUser({
      id: chat.id,
      userId: moderatorMember.id,
      level: "Moderate",
    });

    const asModerator = await as(moderatorMember.id);
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
    const owner = await as(users.regular.id);
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
    const owner = await as(users.admin.id);
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
    const owner = await as(users.admin.id);
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

describe("ChatService member updates (memberUpdate)", () => {
  /** The next memberUpdate a user's sockets get: the chat's members after the change. */
  async function nextMemberUpdate(userId: string): Promise<{
    chatId: string;
    members: ChatMemberDTO[];
  }> {
    const frame = await app.frames.waitFor(
      (candidate) =>
        candidate.event === "qd:event" &&
        candidate.userId === userId &&
        (candidate.data as unknown[])[1] === "memberUpdate",
    );
    return (frame.data as [string, string, { chatId: string; members: ChatMemberDTO[] }])[2];
  }

  it("tells the members when a user is invited", async () => {
    const owner = await as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    const existing = await app.connect({ userId: users.moderator.id });
    app.frames.clear();

    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const update = await nextMemberUpdate(users.moderator.id);
    expect(update.chatId).toBe(chat.id);
    // owner, moderator, regular
    expect(update.members).toHaveLength(3);
    expect(update.members.some((m) => m.userId === users.regular.id)).toBe(true);
    expect(update.members.find((m) => m.userId === users.regular.id)?.user.name).toBe(
      "Regular User",
    );
    existing.close();
  });

  it("tells the remaining members when a user is removed", async () => {
    const owner = await as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const remaining = await app.connect({ userId: users.moderator.id });
    const removed = await app.connect({ userId: users.regular.id });
    app.frames.clear();

    await owner.chatService.removeUser({ id: chat.id, userId: users.regular.id });

    const update = await nextMemberUpdate(users.moderator.id);
    expect(update.members).toHaveLength(2);
    expect(update.members.some((m) => m.userId === users.regular.id)).toBe(false);
    // the removed user is no longer told who is in the chat
    expect(
      app.frames((frame) => frame.event === "qd:event" && frame.userId === users.regular.id),
    ).toHaveLength(0);
    remaining.close();
    removed.close();
  });

  it("tells the remaining members when a user leaves", async () => {
    const owner = await as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Test Chat" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });
    const remaining = await app.connect({ userId: users.moderator.id });
    app.frames.clear();

    await (await as(users.regular.id)).chatService.leaveChat({ id: chat.id });

    const update = await nextMemberUpdate(users.moderator.id);
    expect(update.members).toHaveLength(2);
    expect(update.members.some((m) => m.userId === users.regular.id)).toBe(false);
    remaining.close();
  });
});

describe("ChatService permission cascade (updateTitle needs Moderate)", () => {
  it("allows a service-wide Moderate grant without membership", async () => {
    // users.moderator holds chatService: Moderate
    const chat = await (await as(users.admin.id)).chatService.createChat({ title: "Original" });
    const updated = await (
      await as(users.moderator.id)
    ).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Service Moderate",
    });
    expect(updated.title).toBe("Updated by Service Moderate");
  });

  it("allows a member at Moderate", async () => {
    const owner = await as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Original" });
    await owner.chatService.inviteUser({
      id: chat.id,
      userId: users.regular.id,
      level: "Moderate",
    });
    const updated = await (
      await as(users.regular.id)
    ).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Entry Moderate",
    });
    expect(updated.title).toBe("Updated by Entry Moderate");
  });

  it("allows a service-wide Admin grant (above Moderate)", async () => {
    const chat = await (await as(users.regular.id)).chatService.createChat({ title: "Original" });
    const updated = await (
      await as(users.admin.id)
    ).chatService.updateTitle({
      id: chat.id,
      title: "Updated by Service Admin",
    });
    expect(updated.title).toBe("Updated by Service Admin");
  });

  it("refuses a member at Read", async () => {
    const owner = await as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Original Title" });
    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const reader = await as(users.regular.id);
    expect(
      await codeOf(reader.chatService.updateTitle({ id: chat.id, title: "Unauthorized" })),
    ).toBe("FORBIDDEN");
    const stored = await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(stored.title).toBe("Original Title");
  });

  it("refuses a non-member", async () => {
    const chat = await (
      await as(users.admin.id)
    ).chatService.createChat({ title: "Original Title" });
    const stranger = await as(users.regular.id);
    expect(
      await codeOf(stranger.chatService.updateTitle({ id: chat.id, title: "Unauthorized" })),
    ).toBe("FORBIDDEN");
  });
});

describe("ChatService access matrix", () => {
  it("admits each method's callers", async () => {
    // Users without service grants: the chat's membership alone decides
    const [owner, member, stranger, extra] = await Promise.all([
      createTestUser({ name: "Owner" }),
      createTestUser({ name: "Member" }),
      createTestUser({ name: "Stranger" }),
      createTestUser({ name: "Extra" }),
    ]);
    const ownerCaller = await as(owner.id);
    const chat = await ownerCaller.chatService.createChat({ title: "Matrix" });
    await ownerCaller.chatService.inviteUser({ id: chat.id, userId: member.id, level: "Read" });
    const principals = {
      owner: await principalOf(owner.id),
      member: await principalOf(member.id),
      stranger: await principalOf(stranger.id),
    };

    await describeAccessMatrix(app, {
      service: chatService,
      principals,
      cases: [
        { method: "createChat", input: { title: "Mine" }, allow: ["owner", "member", "stranger"] },
        { method: "getChatMembers", input: { chatId: chat.id }, allow: ["owner", "member"] },
        { method: "updateTitle", input: { id: chat.id, title: "Renamed" }, allow: ["owner"] },
        {
          method: "inviteUser",
          input: { id: chat.id, userId: extra.id, level: "Read" },
          allow: ["owner"],
        },
        {
          method: "inviteByName",
          input: { chatId: chat.id, userName: "Extra", level: "Read" },
          allow: ["owner"],
        },
        { method: "removeUser", input: { id: chat.id, userId: extra.id }, allow: ["owner"] },
        { method: "adminList", input: {}, allow: [] },
        { method: "leaveChat", input: { id: chat.id }, allow: ["owner", "member"] },
      ],
    });
  });
});
