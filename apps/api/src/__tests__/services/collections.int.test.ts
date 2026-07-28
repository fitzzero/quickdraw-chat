// Collection subscriptions (core 4.0) — the template's two collections:
//
// - chatService "myChats":   scope = user id, string[] fan-out (one chat row
//   lands in every member's scope), snapshot with membership `ids` so
//   reconnecting clients prune chats deleted while offline.
// - messageService "byChat": scope = chat id, unbounded history (no `ids`),
//   fully automatic deltas from the CRUD trio.
//
// The client-side merge (rev LWW, pruning, buffering) is exhaustively tested
// in quickdraw-core; these tests pin the SERVER contract the client relies
// on: which deltas reach which scope room, and what re-snapshots return.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDatabase, seedTestUsers } from "@project/db/testing";
import type { CollectionDelta, CollectionSnapshotResponse } from "@fitzzero/quickdraw-core";
import type { ChatListItem, MessageDTO } from "@project/shared";
import { collectionRoom } from "@project/shared";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck, waitForEvent } from "../utils/socket.js";
import type { Socket } from "socket.io-client";

/** Subscribe a socket to a user's myChats scope and return the snapshot. */
function subscribeMyChats(
  socket: Socket,
  userId: string,
): Promise<CollectionSnapshotResponse<ChatListItem>> {
  return emitWithAck(socket, "chatService:collection:subscribe", {
    collection: "myChats",
    scopeId: userId,
  });
}

const myChatsEvent = (userId: string): string => collectionRoom("chatService", "myChats", userId);
const byChatEvent = (chatId: string): string => collectionRoom("messageService", "byChat", chatId);

describe("Collections Integration - myChats (user-scoped fan-out)", () => {
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

  it("fans a created chat out to every initial member's scope (automatic)", async () => {
    const creator = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    // Member watches their own myChats scope
    await subscribeMyChats(member, users.regular.id);
    const addedPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      member,
      myChatsEvent(users.regular.id),
      3000,
    );

    // Creator makes a chat that includes the member from the start —
    // the CRUD trio resolves the fan-out scopes and emits automatically
    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(creator, "chatService:createChat", {
      title: "Group Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    const delta = await addedPromise;
    expect(delta.type).toBe("added");
    if (delta.type !== "added") throw new Error("unreachable");
    expect(delta.item.id).toBe(chat.id);
    expect(delta.item.title).toBe("Group Chat");
    expect(delta.item.memberCount).toBe(2);

    creator.close();
    member.close();
  });

  it("delivers an invited chat to the invitee's scope without refetch", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const invitee = await connectAsUser(port, users.regular.id);

    // Owner creates a chat the invitee can't see yet
    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Invite Target" },
    );

    const snapshot = await subscribeMyChats(invitee, users.regular.id);
    expect(snapshot.items.some((c) => c.id === chat.id)).toBe(false);

    const upsertPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      invitee,
      myChatsEvent(users.regular.id),
      3000,
    );

    await emitWithAck(owner, "chatService:inviteUser", {
      id: chat.id,
      userId: users.regular.id,
      level: "Read",
    });

    // Membership writes go through the manual choke points (upsert semantics)
    const delta = await upsertPromise;
    expect(delta.type).toBe("updated");
    if (delta.type !== "updated") throw new Error("unreachable");
    expect(delta.item.id).toBe(chat.id);
    expect(delta.item.memberCount).toBe(2);

    owner.close();
    invitee.close();
  });

  it("propagates title updates to member scopes (automatic)", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Old Title",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    await subscribeMyChats(member, users.regular.id);
    const updatedPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      member,
      myChatsEvent(users.regular.id),
      3000,
    );

    await emitWithAck(owner, "chatService:updateTitle", {
      id: chat.id,
      title: "New Title",
    });

    const delta = await updatedPromise;
    expect(delta.type).toBe("updated");
    if (delta.type !== "updated") throw new Error("unreachable");
    expect(delta.item.id).toBe(chat.id);
    expect(delta.item.title).toBe("New Title");

    owner.close();
    member.close();
  });

  it("refreshes lastMessageAt in member scopes when a message is posted (cross-service hook)", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Activity Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    const snapshot = await subscribeMyChats(member, users.regular.id);
    expect(snapshot.items.find((c) => c.id === chat.id)?.lastMessageAt).toBeNull();

    const upsertPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      member,
      myChatsEvent(users.regular.id),
      3000,
    );

    // messageService.afterCreate calls chatService.refreshMyChatsItem
    await emitWithAck(owner, "messageService:postMessage", {
      chatId: chat.id,
      content: "Wake up the sidebar",
    });

    const delta = await upsertPromise;
    expect(delta.type).toBe("updated");
    if (delta.type !== "updated") throw new Error("unreachable");
    expect(delta.item.id).toBe(chat.id);
    expect(delta.item.lastMessageAt).not.toBeNull();

    owner.close();
    member.close();
  });

  it("removes the chat from a removed member's scope", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Kick Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    await subscribeMyChats(member, users.regular.id);
    const removedPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      member,
      myChatsEvent(users.regular.id),
      3000,
    );

    await emitWithAck(owner, "chatService:removeUser", {
      id: chat.id,
      userId: users.regular.id,
    });

    const delta = await removedPromise;
    expect(delta.type).toBe("removed");
    if (delta.type !== "removed") throw new Error("unreachable");
    expect(delta.id).toBe(chat.id);

    owner.close();
    member.close();
  });

  it("removes a deleted chat from every member's scope", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Doomed Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    await subscribeMyChats(member, users.regular.id);
    const removedPromise = waitForEvent<CollectionDelta<ChatListItem>>(
      member,
      myChatsEvent(users.regular.id),
      3000,
    );

    // Memberships cascade-delete with the chat, so the service captures the
    // member scopes before deleting and emits the removals manually
    await emitWithAck(owner, "chatService:deleteChat", { id: chat.id });

    const delta = await removedPromise;
    expect(delta.type).toBe("removed");
    if (delta.type !== "removed") throw new Error("unreachable");
    expect(delta.id).toBe(chat.id);

    owner.close();
    member.close();
  });

  it("re-snapshot after reconnect excludes rows deleted while disconnected (ids prune contract)", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    let member = await connectAsUser(port, users.regular.id);

    const keptChat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Kept Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });
    const doomedChat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Doomed Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    // Member sees both chats, then drops offline
    const before = await subscribeMyChats(member, users.regular.id);
    expect(before.items.map((c) => c.id).sort()).toEqual([keptChat.id, doomedChat.id].sort());
    expect(before.ids?.slice().sort()).toEqual([keptChat.id, doomedChat.id].sort());
    member.close();

    // While the member is away: one chat dies, the other changes
    await emitWithAck(owner, "chatService:deleteChat", { id: doomedChat.id });
    await emitWithAck(owner, "chatService:updateTitle", {
      id: keptChat.id,
      title: "Renamed While Away",
    });

    // Reconnect + re-subscribe = re-snapshot. `ids` is the authoritative
    // membership: the client prunes cached rows absent from it, which is
    // exactly how the deletion missed offline heals.
    member = await connectAsUser(port, users.regular.id);
    const after = await subscribeMyChats(member, users.regular.id);

    expect(after.ids).toEqual([keptChat.id]);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]?.id).toBe(keptChat.id);
    expect(after.items[0]?.title).toBe("Renamed While Away");

    owner.close();
    member.close();
  });

  it("denies subscribing to another user's myChats scope", async () => {
    const stranger = await connectAsUser(port, users.regular.id);

    await expect(subscribeMyChats(stranger, users.admin.id)).rejects.toThrow();

    stranger.close();
  });
});

describe("Collections Integration - byChat (chat-scoped, unbounded)", () => {
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

  it("propagates message deletion to a second connected client (automatic)", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const member = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<
      { title: string; members: { userId: string; level: string }[] },
      { id: string }
    >(owner, "chatService:createChat", {
      title: "Deletion Chat",
      members: [{ userId: users.regular.id, level: "Read" }],
    });

    const message = await emitWithAck<{ chatId: string; content: string }, { id: string }>(
      owner,
      "messageService:postMessage",
      { chatId: chat.id, content: "Retract me" },
    );

    await emitWithAck(member, "messageService:collection:subscribe", {
      collection: "byChat",
      scopeId: chat.id,
    });
    const removedPromise = waitForEvent<CollectionDelta<MessageDTO>>(
      member,
      byChatEvent(chat.id),
      3000,
    );

    await emitWithAck(owner, "messageService:deleteMessage", { id: message.id });

    const delta = await removedPromise;
    expect(delta.type).toBe("removed");
    if (delta.type !== "removed") throw new Error("unreachable");
    expect(delta.id).toBe(message.id);

    owner.close();
    member.close();
  });

  it("denies non-members from subscribing to a chat's byChat scope", async () => {
    const owner = await connectAsUser(port, users.admin.id);
    const outsider = await connectAsUser(port, users.regular.id);

    const chat = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "chatService:createChat",
      { title: "Members Only" },
    );

    await expect(
      emitWithAck(outsider, "messageService:collection:subscribe", {
        collection: "byChat",
        scopeId: chat.id,
      }),
    ).rejects.toThrow();

    owner.close();
    outsider.close();
  });
});
