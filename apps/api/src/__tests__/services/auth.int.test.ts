// Sign-in on the auth routes kit: sessions in the Session table, checked on
// every handshake by the server's real `authenticate` (not the test app's
// trusting one), signed out by the routes with the open sockets ended.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { io, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION, type HelloFrame } from "@fitzzero/quickdraw-core";
import { issueSession } from "@fitzzero/quickdraw-core/server/auth";
import { createTestApp, type TestApp } from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { createGrantsLoader } from "../../auth/grants.js";
import { services, serviceNames } from "../../services/index.js";
import { createTestAuth, TEST_WEB_ORIGIN } from "../utils/auth.js";
import { createTestUser } from "../factories/user-factory.js";

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: TestApp<typeof services>;
let users: Users;
const auth = createTestAuth({
  onRevoke: (userId, sessionId) =>
    app.server.access.disconnectUser(userId, sessionId === null ? {} : { sessionId }),
});

beforeAll(async () => {
  const routes = express();
  routes.use(express.json());
  routes.use(auth.routes);
  app = await createTestApp({ services, db: testDb, app: routes, auth: auth.server });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
});

/** A protocol-5 socket with this handshake `auth` (and headers): its hello, or the refusal. */
async function connect(
  handshake: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ socket: Socket; hello: HelloFrame }> {
  const socket = io(app.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: headers,
    auth: { ...handshake, qd: { protocol: PROTOCOL_VERSION, client: "quickdraw-chat-tests" } },
  });
  try {
    const hello = await new Promise<HelloFrame>((resolve, reject) => {
      socket.once("qd:hello", resolve);
      socket.once("connect_error", reject);
    });
    return { socket, hello };
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

describe("sessions on sockets", () => {
  it("signs a socket in with a session's token, with the user's grants", async () => {
    const { token } = await issueSession(auth.keys, users.moderator.id, { provider: "test" });
    const { socket, hello } = await connect({ token });
    expect(hello.userId).toBe(users.moderator.id);
    // the stored grant over SERVICE_DEFAULT_ACCESS (setup.ts)
    expect(hello.serviceAccess).toEqual({ userService: "Read", chatService: "Moderate" });
    socket.disconnect();
  });

  it("signs a socket in with the session cookie from an allowed page", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });
    const { socket, hello } = await connect(
      {},
      { cookie: `session=${token}`, origin: TEST_WEB_ORIGIN },
    );
    expect(hello.userId).toBe(users.regular.id);
    socket.disconnect();

    // ...and refuses the cookie from any other page (a plain-HTTP one: over
    // HTTPS only __Host-session is read, which this cookie is not)
    await expect(
      connect({}, { cookie: `session=${token}`, origin: "http://evil.example.com" }),
    ).rejects.toThrow();
  });

  it("lets a socket in anonymously without credentials", async () => {
    const { socket, hello } = await connect({});
    expect(hello.userId).toBeNull();
    socket.disconnect();
  });

  it("accepts development credentials (auth.userId) for known users only", async () => {
    const { socket, hello } = await connect({ userId: users.regular.id });
    expect(hello.userId).toBe(users.regular.id);
    socket.disconnect();

    const unknown = await connect({ userId: "ckunknownuser000000000000" });
    expect(unknown.hello.userId).toBeNull();
    unknown.socket.disconnect();
  });
});

describe("the session routes", () => {
  it("answers /auth/me, then signs out: the session ends and its sockets close", async () => {
    const { session, token } = await issueSession(auth.keys, users.regular.id, {
      provider: "test",
    });
    const me = await fetch(`${app.url}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await me.json()).toEqual({ userId: users.regular.id });

    const { socket } = await connect({ token });
    const closed = new Promise<string>((resolve) => {
      socket.once("disconnect", resolve);
    });
    const logout = await fetch(`${app.url}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    expect(logout.status).toBe(204);
    expect(await testPrisma.session.findUnique({ where: { id: session.id } })).toBeNull();
    await closed;

    // the token's JWT has not expired, but its session is gone
    await expect(connect({ token })).rejects.toThrow();
    const after = await fetch(`${app.url}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it("signs out every session of a user", async () => {
    const first = await issueSession(auth.keys, users.regular.id, { provider: "test" });
    await issueSession(auth.keys, users.regular.id, { provider: "test" });

    const response = await fetch(`${app.url}/auth/logout-all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${first.token}`, "Content-Type": "application/json" },
    });
    expect(response.status).toBe(204);
    expect(await testPrisma.session.count({ where: { userId: users.regular.id } })).toBe(0);
  });
});

describe("grants", () => {
  it("gives an ADMIN_EMAILS user Admin on every service, stored on their row", async () => {
    const promoted = await createTestUser({ email: "boss@example.com" });
    process.env.ADMIN_EMAILS = "Boss@Example.com";
    try {
      const grants = await createGrantsLoader({ prisma: testPrisma, serviceNames })(promoted.id);
      expect(Object.keys(grants).sort()).toEqual(serviceNames().sort());
      expect(Object.values(grants).every((level) => level === "Admin")).toBe(true);
      const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: promoted.id } });
      expect(stored.serviceAccess).toEqual(grants);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });
});
