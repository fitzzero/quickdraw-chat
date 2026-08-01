import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { PushNotificationPayload } from "@project/shared";
import type { PushTransport } from "../../services/push-subscription/index.js";
import { PushService } from "../../services/push-subscription/index.js";
import { registerPushRoutes } from "../../services/push-subscription/rest.js";
import { createJWT } from "../../auth/jwt.js";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, connectAnonymously, emitWithAck } from "../utils/socket.js";
import { createTestChat } from "../factories/chat-factory.js";

type SubscribePayload = { endpoint: string; keys: { p256dh: string; auth: string } };

const KEYS = { p256dh: "test-p256dh-key", auth: "test-auth-secret" };

describe("PushService Integration", () => {
  // Captured deliveries from the injected transport (cleared per test)
  const sends: Array<{ endpoint: string; payload: PushNotificationPayload }> = [];
  const onlineUsers = new Set<string>();
  const deadEndpoints = new Set<string>();

  const transport: PushTransport = async (subscription, payload) => {
    if (deadEndpoints.has(subscription.endpoint)) {
      const err = new Error("gone") as Error & { statusCode: number };
      err.statusCode = 410;
      throw err;
    }
    sends.push({
      endpoint: subscription.endpoint,
      payload: JSON.parse(payload) as PushNotificationPayload,
    });
  };

  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer({
      push: { transport, isUserOnline: async (userId) => onlineUsers.has(userId) },
    });
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
    sends.length = 0;
    onlineUsers.clear();
    deadEndpoints.clear();
  });

  async function subscribe(userId: string, endpoint: string): Promise<void> {
    const client = await connectAsUser(port, userId);
    await emitWithAck<SubscribePayload, { success: true }>(client, "pushService:subscribePush", {
      endpoint,
      keys: KEYS,
    });
    client.close();
  }

  describe("subscribePush", () => {
    it("registers an endpoint for the calling user", async () => {
      await subscribe(users.regular.id, "https://push.example.com/regular-1");

      const row = await testPrisma.pushSubscription.findUnique({
        where: { endpoint: "https://push.example.com/regular-1" },
      });
      expect(row?.userId).toBe(users.regular.id);
      expect(row?.p256dh).toBe(KEYS.p256dh);
    });

    it("upserts on re-subscribe instead of duplicating", async () => {
      await subscribe(users.regular.id, "https://push.example.com/regular-1");
      await subscribe(users.regular.id, "https://push.example.com/regular-1");

      const count = await testPrisma.pushSubscription.count({
        where: { userId: users.regular.id },
      });
      expect(count).toBe(1);
    });

    it("rejects anonymous callers", async () => {
      const client = await connectAnonymously(port);
      await expect(
        emitWithAck<SubscribePayload, { success: true }>(client, "pushService:subscribePush", {
          endpoint: "https://push.example.com/anon",
          keys: KEYS,
        }),
      ).rejects.toThrow();
      client.close();
    });

    it("rejects non-URL endpoints", async () => {
      const client = await connectAsUser(port, users.regular.id);
      await expect(
        emitWithAck<SubscribePayload, { success: true }>(client, "pushService:subscribePush", {
          endpoint: "not-a-url",
          keys: KEYS,
        }),
      ).rejects.toThrow();
      client.close();
    });
  });

  describe("unsubscribePush", () => {
    it("removes the caller's endpoint", async () => {
      await subscribe(users.regular.id, "https://push.example.com/regular-1");

      const client = await connectAsUser(port, users.regular.id);
      await emitWithAck<{ endpoint: string }, { success: true }>(
        client,
        "pushService:unsubscribePush",
        { endpoint: "https://push.example.com/regular-1" },
      );
      client.close();

      const count = await testPrisma.pushSubscription.count();
      expect(count).toBe(0);
    });

    it("does not remove another user's endpoint", async () => {
      await subscribe(users.regular.id, "https://push.example.com/regular-1");

      const client = await connectAsUser(port, users.moderator.id);
      await emitWithAck<{ endpoint: string }, { success: true }>(
        client,
        "pushService:unsubscribePush",
        { endpoint: "https://push.example.com/regular-1" },
      );
      client.close();

      const count = await testPrisma.pushSubscription.count();
      expect(count).toBe(1);
    });
  });

  describe("sendTestPush", () => {
    it("delivers to every subscription of the caller", async () => {
      await subscribe(users.regular.id, "https://push.example.com/device-1");
      await subscribe(users.regular.id, "https://push.example.com/device-2");

      const client = await connectAsUser(port, users.regular.id);
      const result = await emitWithAck<Record<string, never>, { sent: number }>(
        client,
        "pushService:sendTestPush",
        {},
      );
      client.close();

      expect(result.sent).toBe(2);
      expect(sends).toHaveLength(2);
      expect(sends[0]?.payload.title).toBeTruthy();
    });

    it("prunes endpoints the push service reports gone (410)", async () => {
      await subscribe(users.regular.id, "https://push.example.com/expired");
      deadEndpoints.add("https://push.example.com/expired");

      const client = await connectAsUser(port, users.regular.id);
      const result = await emitWithAck<Record<string, never>, { sent: number }>(
        client,
        "pushService:sendTestPush",
        {},
      );
      client.close();

      expect(result.sent).toBe(0);
      await vi.waitFor(async () => {
        expect(await testPrisma.pushSubscription.count()).toBe(0);
      });
    });
  });

  describe("new-message pushes", () => {
    it("notifies offline members only, never the sender", async () => {
      const chat = await createTestChat({
        title: "Push Chat",
        members: [
          { userId: users.admin.id }, // sender
          { userId: users.regular.id }, // offline → should get a push
          { userId: users.moderator.id }, // online → skipped
        ],
      });
      await subscribe(users.regular.id, "https://push.example.com/offline-member");
      await subscribe(users.moderator.id, "https://push.example.com/online-member");
      await subscribe(users.admin.id, "https://push.example.com/sender");
      onlineUsers.add(users.moderator.id);

      const client = await connectAsUser(port, users.admin.id);
      await emitWithAck<{ chatId: string; content: string }, { id: string }>(
        client,
        "messageService:postMessage",
        { chatId: chat.id, content: "Hello offline friends" },
      );
      client.close();

      // afterCreate fires the push fire-and-forget — wait for delivery
      await vi.waitFor(() => {
        expect(sends).toHaveLength(1);
      });
      const send = sends[0];
      expect(send?.endpoint).toBe("https://push.example.com/offline-member");
      expect(send?.payload.title).toBe("Push Chat");
      expect(send?.payload.body).toContain("Hello offline friends");
      expect(send?.payload.url).toBe(`/chats/${chat.id}`);
      expect(send?.payload.tag).toBe(`chat-${chat.id}`);
    });

    it("truncates long message previews", async () => {
      const chat = await createTestChat({
        title: "Push Chat",
        members: [{ userId: users.admin.id }, { userId: users.regular.id }],
      });
      await subscribe(users.regular.id, "https://push.example.com/offline-member");

      const client = await connectAsUser(port, users.admin.id);
      await emitWithAck<{ chatId: string; content: string }, { id: string }>(
        client,
        "messageService:postMessage",
        { chatId: chat.id, content: "x".repeat(500) },
      );
      client.close();

      await vi.waitFor(() => {
        expect(sends).toHaveLength(1);
      });
      expect(sends[0]?.payload.body.length).toBeLessThanOrEqual(140);
      expect(sends[0]?.payload.body.endsWith("…")).toBe(true);
    });
  });
});

describe("Push resubscribe REST", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const pushService = new PushService(testPrisma);
    registerPushRoutes(app, pushService, { db: testPrisma });

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  async function authedUser(): Promise<{ userId: string; token: string }> {
    const users = await seedTestUsers();
    const token = await createJWT({ userId: users.regular.id });
    await testPrisma.session.create({
      data: {
        userId: users.regular.id,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { userId: users.regular.id, token };
  }

  function resubscribe(token: string | null, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/push/resubscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("renews a subscription for the authenticated user", async () => {
    const { userId, token } = await authedUser();

    const response = await resubscribe(token, {
      endpoint: "https://push.example.com/renewed",
      keys: KEYS,
    });
    expect(response.status).toBe(200);

    const row = await testPrisma.pushSubscription.findUnique({
      where: { endpoint: "https://push.example.com/renewed" },
    });
    expect(row?.userId).toBe(userId);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const response = await resubscribe(null, {
      endpoint: "https://push.example.com/renewed",
      keys: KEYS,
    });
    expect(response.status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    const { token } = await authedUser();
    const response = await resubscribe(token, { endpoint: "not-a-url" });
    expect(response.status).toBe(400);
  });
});
