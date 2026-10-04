// The template's two collections, served by the framework from tracked writes:
//
// - chatService "myChats": scope = a user id, through the membership table
//   (`via` chatMember): one chat is an item in each member's list, ordered by
//   its latest activity (Chat.lastMessageAt) with a small index of the whole
//   list on the first page.
// - messageService "byChat": scope = a chat id, anchored on the chat (Read on
//   it opens the scope), newest first, 50 a page.
//
// These tests pin which deltas reach which scope, and what a fresh snapshot
// holds: the client-side merge is quickdraw-core's own tested code.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { CollectionDelta, CollectionFrame } from "@fitzzero/quickdraw-core";
import { expectBudget } from "@fitzzero/quickdraw-core/testing";
import { resetDatabase, seedTestUsers, testPrisma } from "@project/db/testing";
import type { ChatListItem, MessageDTO } from "@project/shared";
import { startTestApp, subscribeScope, type ApiConnection, type ApiTestApp } from "../utils/app.js";
import { createTestChat } from "../factories/chat-factory.js";

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

function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

/** A snapshot's items, or a failure for a refused subscription. */
async function snapshotOf<Item>(
  connection: ApiConnection,
  service: string,
  collection: string,
  scope: string,
  page?: { limit?: number; cursor?: string },
): Promise<{ items: Item[]; total: number; cursor: string | null; index?: unknown[][] }> {
  const reply = await subscribeScope(connection, service, collection, scope, page);
  if (!reply.ok || !("items" in reply)) {
    throw new Error(`expected a snapshot, got ${JSON.stringify(reply)}`);
  }
  return reply as unknown as { items: Item[]; total: number; cursor: string | null };
}

/** The next delta a user's sockets get for one scope of a collection. */
async function nextDelta<Item>(
  userId: string,
  collection: string,
  scope: string,
  test: (delta: CollectionDelta<Item>) => boolean = () => true,
): Promise<CollectionDelta<Item>> {
  const matches = (data: unknown): CollectionDelta<Item> | undefined => {
    const frame = data as CollectionFrame<Item>;
    return frame.c === collection && frame.scope === scope ? frame.deltas.find(test) : undefined;
  };
  const frame = await app.frames.waitFor(
    (candidate) =>
      candidate.event === "qd:c" &&
      candidate.userId === userId &&
      matches(candidate.data) !== undefined,
  );
  const delta = matches(frame.data);
  if (delta === undefined) throw new Error("unreachable");
  return delta;
}

/** The item a delta carries (`added`, `updated`), or its changed fields (`patched`). */
function itemOf<Item>(delta: CollectionDelta<Item>): Partial<Item> {
  if (delta.t === "added" || delta.t === "updated") return delta.item;
  if (delta.t === "patched") return delta.d;
  throw new Error(`no item in a ${delta.t} delta`);
}

describe("myChats (each member's list, through the membership table)", () => {
  it("adds a created chat to every initial member's list", async () => {
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    const chat = await as(users.admin.id).chatService.createChat({
      title: "Group Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    const delta = await nextDelta<ChatListItem>(users.regular.id, "myChats", users.regular.id);
    expect(delta.t).toBe("added");
    expect(itemOf(delta)).toMatchObject({ id: chat.id, title: "Group Chat", memberCount: 2 });
    member.close();
  });

  it("adds a chat to an invitee's list without a refetch", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({ title: "Invite Target" });
    const invitee = await app.connect({ userId: users.regular.id });
    const before = await snapshotOf<ChatListItem>(
      invitee,
      "chatService",
      "myChats",
      users.regular.id,
    );
    expect(before.items.some((c) => c.id === chat.id)).toBe(false);

    await owner.chatService.inviteUser({ id: chat.id, userId: users.regular.id, level: "Read" });

    const delta = await nextDelta<ChatListItem>(users.regular.id, "myChats", users.regular.id);
    expect(delta.t).toBe("added");
    expect(itemOf(delta)).toMatchObject({ id: chat.id, memberCount: 2 });
    invitee.close();
  });

  it("updates the member count in the other members' lists", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Growing",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    await owner.chatService.inviteUser({ id: chat.id, userId: users.moderator.id, level: "Read" });

    const delta = await nextDelta<ChatListItem>(
      users.regular.id,
      "myChats",
      users.regular.id,
      (candidate) => candidate.t !== "removed" && itemOf(candidate).memberCount === 3,
    );
    expect(itemOf(delta)).toMatchObject({ id: chat.id, memberCount: 3 });
    member.close();
  });

  it("updates the member count in the remaining members' lists when one is removed", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Shrinking",
      members: [
        { userId: users.regular.id, level: "Read" },
        { userId: users.moderator.id, level: "Read" },
      ],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    await owner.chatService.removeUser({ id: chat.id, userId: users.moderator.id });

    // the membership write sends the chat again to every list still holding it
    const delta = await nextDelta<ChatListItem>(
      users.regular.id,
      "myChats",
      users.regular.id,
      (candidate) => candidate.t !== "removed" && itemOf(candidate).memberCount === 2,
    );
    expect(itemOf(delta)).toMatchObject({ id: chat.id, memberCount: 2 });
    member.close();
  });

  it("sends a rename to the members' lists", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Old Title",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    await owner.chatService.updateTitle({ id: chat.id, title: "New Title" });

    const delta = await nextDelta<ChatListItem>(users.regular.id, "myChats", users.regular.id);
    expect(itemOf(delta)).toMatchObject({ title: "New Title" });
    member.close();
  });

  it("moves a chat to the top of the sender's and the members' lists when a message is posted", async () => {
    const owner = as(users.admin.id);
    const quiet = await owner.chatService.createChat({
      title: "Quiet",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const busy = await owner.chatService.createChat({
      title: "Busy",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    const sender = await app.connect({ userId: users.admin.id });
    const before = await snapshotOf<ChatListItem>(
      member,
      "chatService",
      "myChats",
      users.regular.id,
    );
    // newest activity first: the chat created last
    expect(before.items.map((c) => c.id)).toEqual([busy.id, quiet.id]);
    await snapshotOf(sender, "chatService", "myChats", users.admin.id);
    app.frames.clear();

    await owner.messageService.postMessage({ chatId: quiet.id, content: "Wake up the sidebar" });

    for (const userId of [users.regular.id, users.admin.id]) {
      const delta = await nextDelta<ChatListItem>(userId, "myChats", userId);
      const item = itemOf(delta);
      expect(item.id ?? (delta.t === "patched" ? delta.id : undefined)).toBe(quiet.id);
      expect(Date.parse(item.lastMessageAt ?? "")).toBeGreaterThan(
        Date.parse(before.items[1]?.lastMessageAt ?? ""),
      );
    }
    const after = await snapshotOf<ChatListItem>(
      await app.connect({ userId: users.regular.id }),
      "chatService",
      "myChats",
      users.regular.id,
    );
    expect(after.items.map((c) => c.id)).toEqual([quiet.id, busy.id]);
    member.close();
    sender.close();
  });

  it("removes the chat from a removed member's list", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Kick Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    await owner.chatService.removeUser({ id: chat.id, userId: users.regular.id });

    const delta = await nextDelta<ChatListItem>(
      users.regular.id,
      "myChats",
      users.regular.id,
      (candidate) => candidate.t === "removed",
    );
    expect(delta).toEqual({ t: "removed", id: chat.id });
    member.close();
  });

  it("removes a deleted chat from every member's list", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Doomed Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "chatService", "myChats", users.regular.id);

    await owner.chatService.deleteChat({ id: chat.id });

    const delta = await nextDelta<ChatListItem>(
      users.regular.id,
      "myChats",
      users.regular.id,
      (candidate) => candidate.t === "removed",
    );
    expect(delta).toEqual({ t: "removed", id: chat.id });
    member.close();
  });

  it("answers a fresh list after a reconnect, without the chats deleted meanwhile", async () => {
    const owner = as(users.admin.id);
    const kept = await owner.chatService.createChat({
      title: "Kept Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const doomed = await owner.chatService.createChat({
      title: "Doomed Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    let member = await app.connect({ userId: users.regular.id });
    const before = await snapshotOf<ChatListItem>(
      member,
      "chatService",
      "myChats",
      users.regular.id,
    );
    expect(before.items.map((c) => c.id).sort()).toEqual([kept.id, doomed.id].sort());
    // The index lists the whole membership: [id, rev, lastMessageAt, title, memberCount]
    expect(before.index?.map((row) => row[0]).sort()).toEqual([kept.id, doomed.id].sort());
    member.close();

    // While the member is away: one chat dies, the other changes
    await owner.chatService.deleteChat({ id: doomed.id });
    await owner.chatService.updateTitle({ id: kept.id, title: "Renamed While Away" });

    member = await app.connect({ userId: users.regular.id });
    const after = await snapshotOf<ChatListItem>(
      member,
      "chatService",
      "myChats",
      users.regular.id,
    );
    expect(after.total).toBe(1);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ id: kept.id, title: "Renamed While Away" });
    expect(after.index?.map((row) => row[0])).toEqual([kept.id]);
    member.close();
  });

  it("refuses another user's list", async () => {
    const stranger = await app.connect({ userId: users.regular.id });
    const reply = await subscribeScope(stranger, "chatService", "myChats", users.admin.id);
    expect(reply).toMatchObject({ ok: false, e: { code: "FORBIDDEN" } });
    stranger.close();
  });

  it("costs a fixed number of statements to open a list of 30 chats", async () => {
    for (let i = 0; i < 30; i++) {
      await createTestChat({
        title: `Chat ${i}`,
        members: [{ userId: users.regular.id, level: "Admin" }, { userId: users.admin.id }],
      });
    }
    // a first snapshot pays one-time reads (the storage adapter's column checks)
    const warmUp = await app.connect({ userId: users.regular.id });
    await snapshotOf(warmUp, "chatService", "myChats", users.regular.id);
    warmUp.close();
    const member = await app.connect({ userId: users.regular.id });
    let total = 0;
    await expectBudget(
      async () => {
        total = (await snapshotOf(member, "chatService", "myChats", users.regular.id)).total;
      },
      { name: "open myChats with 30 chats" },
    );
    expect(total).toBe(30);
    member.close();
  });
});

describe("byChat (a chat's messages, anchored on the chat)", () => {
  it("sends a new message to the chat's subscribers, and nobody else", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Broadcast",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "messageService", "byChat", chat.id);
    const outsider = await app.connect({ userId: users.moderator.id });
    expect(await subscribeScope(outsider, "messageService", "byChat", chat.id)).toMatchObject({
      ok: false,
      e: { code: "FORBIDDEN" },
    });

    const message = await owner.messageService.postMessage({
      chatId: chat.id,
      content: "Hello from owner!",
    });

    const delta = await nextDelta<MessageDTO>(users.regular.id, "byChat", chat.id);
    expect(delta.t).toBe("added");
    expect(itemOf(delta)).toMatchObject({
      id: message.id,
      content: "Hello from owner!",
      userId: users.admin.id,
      chatId: chat.id,
      user: { id: users.admin.id, name: "Admin User" },
    });
    expect(app.frames({ event: "qd:c", userId: users.moderator.id })).toHaveLength(0);
    member.close();
    outsider.close();
  });

  it("removes a deleted message from a second client's history", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Deletion Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const message = await owner.messageService.postMessage({ chatId: chat.id, content: "Retract" });
    const member = await app.connect({ userId: users.regular.id });
    await snapshotOf(member, "messageService", "byChat", chat.id);

    await owner.messageService.deleteMessage({ id: message.id });

    const delta = await nextDelta<MessageDTO>(
      users.regular.id,
      "byChat",
      chat.id,
      (candidate) => candidate.t === "removed",
    );
    expect(delta).toEqual({ t: "removed", id: message.id });
    member.close();
  });

  it("costs a fixed number of statements to send a message to three subscribers", async () => {
    const owner = as(users.admin.id);
    const chat = await owner.chatService.createChat({
      title: "Three Watchers",
      members: [
        { userId: users.regular.id, level: "Read" },
        { userId: users.moderator.id, level: "Read" },
      ],
    });
    // three subscribers of the chat's history: the sender and two members
    const watchers = await Promise.all(
      [users.admin.id, users.regular.id, users.moderator.id].map((userId) =>
        app.connect({ userId }),
      ),
    );
    for (const watcher of watchers) {
      await snapshotOf(watcher, "messageService", "byChat", chat.id);
    }
    await owner.messageService.postMessage({ chatId: chat.id, content: "Warm-up" });
    await nextDelta<MessageDTO>(users.moderator.id, "byChat", chat.id);
    app.frames.clear();

    await expectBudget(
      async () => {
        await owner.messageService.postMessage({ chatId: chat.id, content: "Measured" });
        await Promise.all(
          [users.admin.id, users.regular.id, users.moderator.id].map((userId) =>
            nextDelta<MessageDTO>(userId, "byChat", chat.id),
          ),
        );
      },
      { name: "send a message to 3 subscribers" },
    );
    const stored = await testPrisma.message.count({ where: { chatId: chat.id } });
    expect(stored).toBe(2);
    for (const watcher of watchers) {
      watcher.close();
    }
  });
});
