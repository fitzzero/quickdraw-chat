import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { issueSession } from "@fitzzero/quickdraw-core/server/auth";
import { describeAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { PushNotificationPayload } from "@project/shared";
import { prismaSessions } from "../../auth/sessions.js";
import { pushService, type PushTransport } from "../../services/push-subscription/index.js";
import { registerPushRoutes } from "../../services/push-subscription/rest.js";
import { startTestApp, type ApiTestApp } from "../utils/app.js";
import { TEST_JWT_SECRET } from "../utils/auth.js";
import { createTestChat } from "../factories/chat-factory.js";

const KEYS = { p256dh: "test-p256dh-key", auth: "test-auth-secret" };

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

// Captured deliveries from the injected transport (cleared per test)
const sends: { endpoint: string; payload: PushNotificationPayload }[] = [];
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

const keys = { sessions: prismaSessions(testPrisma), jwtSecret: TEST_JWT_SECRET };

let app: ApiTestApp;
let users: Users;

beforeAll(async () => {
  // The service-worker REST route is served by the test server too
  const routes = express();
  routes.use(express.json());
  registerPushRoutes(routes, keys);
  app = await startTestApp({
    app: routes,
    push: { transport, isUserOnline: (userId) => Promise.resolve(onlineUsers.has(userId)) },
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
  sends.length = 0;
  onlineUsers.clear();
  deadEndpoints.clear();
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

async function subscribe(userId: string, endpoint: string): Promise<void> {
  // over a socket, as the browser registers it
  const connection = await app.connect({ userId });
  await connection.call.pushService.subscribePush({ endpoint, keys: KEYS });
  connection.close();
}

describe("PushService subscribePush", () => {
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

    expect(await testPrisma.pushSubscription.count({ where: { userId: users.regular.id } })).toBe(
      1,
    );
  });

  it("refuses anonymous callers", async () => {
    expect(
      await codeOf(
        app
          .as(null)
          .pushService.subscribePush({ endpoint: "https://push.example.com/anon", keys: KEYS }),
      ),
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses non-URL endpoints", async () => {
    expect(
      await codeOf(
        as(users.regular.id).pushService.subscribePush({
          endpoint: "not-a-url",
          keys: KEYS,
        }),
      ),
    ).toBe("VALIDATION");
  });
});

describe("PushService unsubscribePush", () => {
  it("removes the caller's endpoint", async () => {
    await subscribe(users.regular.id, "https://push.example.com/regular-1");
    await as(users.regular.id).pushService.unsubscribePush({
      endpoint: "https://push.example.com/regular-1",
    });
    expect(await testPrisma.pushSubscription.count()).toBe(0);
  });

  it("does not remove another user's endpoint", async () => {
    await subscribe(users.regular.id, "https://push.example.com/regular-1");
    await as(users.moderator.id).pushService.unsubscribePush({
      endpoint: "https://push.example.com/regular-1",
    });
    expect(await testPrisma.pushSubscription.count()).toBe(1);
  });
});

describe("PushService sendTestPush", () => {
  it("delivers to every subscription of the caller", async () => {
    await subscribe(users.regular.id, "https://push.example.com/device-1");
    await subscribe(users.regular.id, "https://push.example.com/device-2");

    const result = await as(users.regular.id).pushService.sendTestPush({});

    expect(result.sent).toBe(2);
    expect(sends).toHaveLength(2);
    expect(sends[0]?.payload.title).toBeTruthy();
  });

  it("prunes endpoints the push service reports gone (410)", async () => {
    await subscribe(users.regular.id, "https://push.example.com/expired");
    deadEndpoints.add("https://push.example.com/expired");

    const result = await as(users.regular.id).pushService.sendTestPush({});

    expect(result.sent).toBe(0);
    expect(await testPrisma.pushSubscription.count()).toBe(0);
  });
});

describe("PushService new-message pushes", () => {
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

    await as(users.admin.id).messageService.postMessage({
      chatId: chat.id,
      content: "Hello offline friends",
    });

    // the push goes out fire-and-forget after the post: wait for delivery
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

    await as(users.admin.id).messageService.postMessage({
      chatId: chat.id,
      content: "x".repeat(500),
    });

    await vi.waitFor(() => {
      expect(sends).toHaveLength(1);
    });
    expect(sends[0]?.payload.body.length).toBeLessThanOrEqual(140);
    expect(sends[0]?.payload.body.endsWith("…")).toBe(true);
  });

  it("prunes a member's dead endpoint after the post has answered", async () => {
    const chat = await createTestChat({
      title: "Push Chat",
      members: [{ userId: users.admin.id }, { userId: users.regular.id }],
    });
    await subscribe(users.regular.id, "https://push.example.com/expired");
    deadEndpoints.add("https://push.example.com/expired");

    // the push runs detached (a unit of work of its own): the post answers
    // first, the endpoint is deleted when the push service has refused it
    await as(users.admin.id).messageService.postMessage({ chatId: chat.id, content: "Anyone?" });

    await vi.waitFor(async () => {
      expect(await testPrisma.pushSubscription.count()).toBe(0);
    });
    expect(sends).toHaveLength(0);
  });
});

describe("PushService access matrix", () => {
  it("admits each method's callers", async () => {
    await describeAccessMatrix(app, {
      service: pushService,
      principals: {
        user: { userId: users.regular.id },
        pushAdmin: { userId: users.admin.id, serviceAccess: { pushService: "Admin" } },
      },
      cases: [
        {
          method: "subscribePush",
          input: { endpoint: "https://push.example.com/matrix", keys: KEYS },
          allow: ["user", "pushAdmin"],
        },
        {
          method: "unsubscribePush",
          input: { endpoint: "https://push.example.com/matrix" },
          allow: ["user", "pushAdmin"],
        },
        { method: "sendTestPush", input: {}, allow: ["user", "pushAdmin"] },
        { method: "adminList", input: {}, allow: ["pushAdmin"] },
      ],
    });
  });
});

describe("Push resubscribe REST", () => {
  async function resubscribe(token: string | null, body: unknown): Promise<Response> {
    return await fetch(`${app.url}/api/push/resubscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  }

  it("renews a subscription for the session's user", async () => {
    const { token } = await issueSession(keys, users.regular.id, { provider: "test" });

    const response = await resubscribe(token, {
      endpoint: "https://push.example.com/renewed",
      keys: KEYS,
    });
    expect(response.status).toBe(200);

    const row = await testPrisma.pushSubscription.findUnique({
      where: { endpoint: "https://push.example.com/renewed" },
    });
    expect(row?.userId).toBe(users.regular.id);
  });

  it("takes the session cookie the service worker sends", async () => {
    const { token } = await issueSession(keys, users.regular.id, { provider: "test" });

    const response = await fetch(`${app.url}/api/push/resubscribe`, {
      method: "POST",
      // plain HTTP: the cookie is `session` (`__Host-session` over HTTPS)
      headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
      body: JSON.stringify({ endpoint: "https://push.example.com/from-cookie", keys: KEYS }),
    });
    expect(response.status).toBe(200);

    const row = await testPrisma.pushSubscription.findUnique({
      where: { endpoint: "https://push.example.com/from-cookie" },
    });
    expect(row?.userId).toBe(users.regular.id);
  });

  it("rejects unauthenticated requests, and signed-out sessions, with 401", async () => {
    const anonymous = await resubscribe(null, {
      endpoint: "https://push.example.com/renewed",
      keys: KEYS,
    });
    expect(anonymous.status).toBe(401);

    const { session, token } = await issueSession(keys, users.regular.id, { provider: "test" });
    await keys.sessions.revoke(session.id);
    const revoked = await resubscribe(token, {
      endpoint: "https://push.example.com/renewed",
      keys: KEYS,
    });
    expect(revoked.status).toBe(401);
  });

  it("rejects malformed bodies with 400", async () => {
    const { token } = await issueSession(keys, users.regular.id, { provider: "test" });
    const response = await resubscribe(token, { endpoint: "not-a-url" });
    expect(response.status).toBe(400);
  });
});
