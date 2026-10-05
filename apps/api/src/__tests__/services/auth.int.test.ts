// Sign-in on the auth routes kit: sessions in the Session table, checked on
// every handshake by the server's real `authenticate` (not the test app's
// trusting one), signed out by the routes with the open sockets ended; and
// the kit's GET /auth/providers as this app configures it: what the login
// page offers.
import { once } from "node:events";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import express from "express";
import { io, type Socket } from "socket.io-client";
import { PROTOCOL_VERSION, type HelloFrame } from "@fitzzero/quickdraw-core";
import { issueSession, type OAuthTokenResponse } from "@fitzzero/quickdraw-core/server/auth";
import { createTestApp, type TestApp } from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { AccessLevel } from "@project/shared";
import { allowedOriginsFromEnv } from "../../auth/config.js";
import { createGrantsLoader } from "../../auth/grants.js";
import { createAppAuth } from "../../auth/index.js";
import { upsertOAuthUser, type SignInProfile } from "../../auth/users.js";
import { services, serviceNames } from "../../services/index.js";
import { createTestAuth, TEST_JWT_SECRET, TEST_WEB_ORIGIN } from "../utils/auth.js";
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
  url: string = app.url,
): Promise<{ socket: Socket; hello: HelloFrame }> {
  const socket = io(url, {
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

    // socketAuth's devCredentials refuses an unknown user rather than letting
    // the socket in anonymously
    await expect(connect({ userId: "ckunknownuser000000000000" })).rejects.toThrow();
  });
});

describe("HTTP calls (POST /qd) with the session cookie", () => {
  /** `userService.getMe` over HTTP with the session cookie (`session` over plain HTTP) and `headers`. */
  async function getMe(token: string, headers: Record<string, string> = {}): Promise<Response> {
    return await fetch(`${app.url}/qd/userService/getMe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${token}`, ...headers },
      body: "{}",
    });
  }

  it("answers a call from an allowed page, and refuses another site's page (403)", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });

    const allowed = await getMe(token, { Origin: TEST_WEB_ORIGIN });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ ok: true, d: { id: users.regular.id } });

    // a page elsewhere calling with the user's cookie, as the socket test above
    const crossSite = await getMe(token, { Origin: "http://evil.example.com" });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toMatchObject({ ok: false, e: { code: "FORBIDDEN" } });
  });

  it("answers a call without Origin (a server forwarding the cookie), unless it says another site sent it", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });

    // what createServerCaller sends from a server rendering a page
    const forwarded = await getMe(token);
    expect(forwarded.status).toBe(200);
    expect(await forwarded.json()).toMatchObject({ ok: true, d: { id: users.regular.id } });

    expect((await getMe(token, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });

  it("checks no Origin for a bearer token, which no other page can send", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });
    const response = await fetch(`${app.url}/qd/userService/getMe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "http://evil.example.com",
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, d: { id: users.regular.id } });
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
    const promoted = await createTestUser({ email: "boss@example.com", emailVerified: true });
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

  it("gives an ADMIN_EMAILS address no provider verified the defaults only, not the grants on its row", async () => {
    // a row that claimed the address through an unverified sign-in before
    // 5.0 checked, and received a bootstrap's grants then
    const squatter = await createTestUser({
      email: "boss@example.com",
      serviceAccess: Object.fromEntries(
        serviceNames().map((name): [string, AccessLevel] => [name, "Admin"]),
      ),
    });
    process.env.ADMIN_EMAILS = "boss@example.com";
    try {
      const grants = await createGrantsLoader({ prisma: testPrisma, serviceNames })(squatter.id);
      expect(grants).toEqual({ userService: "Read" });
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });
});

describe("sign-in accounts and verified emails", () => {
  const tokens: OAuthTokenResponse = { access_token: "access", token_type: "Bearer" };
  const loadGrants = createGrantsLoader({ prisma: testPrisma, serviceNames });

  /** A provider's profile for `upsertOAuthUser`. */
  function profile(
    providerAccountId: string,
    email: string | null,
    emailVerified: boolean,
  ): SignInProfile {
    return { providerAccountId, email, emailVerified, name: null, image: null, tokens };
  }

  /** The providers a user can sign in with. */
  async function accountsOf(userId: string): Promise<string[]> {
    const accounts = await testPrisma.account.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
    return accounts.map((account) => account.provider);
  }

  it("never makes an unverified ADMIN_EMAILS address an admin (ADMIN-SQUAT)", async () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    try {
      const squatterId = await upsertOAuthUser(
        testPrisma,
        profile("discord-mallory", "boss@example.com", false),
        "discord",
      );
      if (squatterId === null) throw new Error("expected a user");
      const squatter = await testPrisma.user.findUniqueOrThrow({ where: { id: squatterId } });
      expect(squatter).toMatchObject({
        email: "discord-mallory@discord.local",
        emailVerified: false,
      });
      expect(await loadGrants(squatterId)).toEqual({ userService: "Read" });

      // the real admin's verified sign-in gets the address, and Admin
      const bossId = await upsertOAuthUser(
        testPrisma,
        profile("google-boss", "boss@example.com", true),
        "google",
      );
      if (bossId === null) throw new Error("expected a user");
      expect(bossId).not.toBe(squatterId);
      const grants = await loadGrants(bossId);
      expect(Object.values(grants).every((level) => level === "Admin")).toBe(true);
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("never links a verified sign-in into a user an unverified email made (PRE-HIJACK)", async () => {
    const attackerId = await upsertOAuthUser(
      testPrisma,
      profile("discord-mallory", "victim@example.com", false),
      "discord",
    );
    const victimId = await upsertOAuthUser(
      testPrisma,
      profile("google-victim", "victim@example.com", true),
      "google",
    );
    if (attackerId === null || victimId === null) throw new Error("expected two users");
    expect(victimId).not.toBe(attackerId);
    expect(await accountsOf(attackerId)).toEqual(["discord"]);
    expect(await accountsOf(victimId)).toEqual(["google"]);
    const victim = await testPrisma.user.findUniqueOrThrow({ where: { id: victimId } });
    expect(victim).toMatchObject({ email: "victim@example.com", emailVerified: true });
  });

  it("gives an unverified email of an existing user a placeholder user of its own", async () => {
    const existing = await createTestUser({ email: "taken@example.com" });
    const signedIn = await upsertOAuthUser(
      testPrisma,
      profile("discord-42", "taken@example.com", false),
      "discord",
    );
    if (signedIn === null) throw new Error("expected a user");
    expect(signedIn).not.toBe(existing.id);
    expect(await accountsOf(existing.id)).toEqual([]);
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: signedIn } })).email).toBe(
      "discord-42@discord.local",
    );
  });

  it("refuses a verified sign-in to a user someone signed in to with that address unverified", async () => {
    // a pre-claim from before 5.0 checked: the address stored, never verified
    const preClaimed = await testPrisma.user.create({
      data: {
        email: "victim@example.com",
        accounts: { create: { provider: "discord", providerAccountId: "discord-mallory" } },
      },
      select: { id: true },
    });
    expect(
      await upsertOAuthUser(
        testPrisma,
        profile("google-victim", "victim@example.com", true),
        "google",
      ),
    ).toBeNull();
    expect(await accountsOf(preClaimed.id)).toEqual(["discord"]);
  });

  it("links a verified sign-in to a user without accounts (seeded or pre-provisioned)", async () => {
    const seeded = await createTestUser({ email: "seeded@example.com" });
    const signedIn = await upsertOAuthUser(
      testPrisma,
      profile("google-seeded", "seeded@example.com", true),
      "google",
    );
    expect(signedIn).toBe(seeded.id);
    expect(await accountsOf(seeded.id)).toEqual(["google"]);
    const row = await testPrisma.user.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(row.emailVerified).toBe(true);
  });

  it("records an address at the next sign-in that verifies it: the stored one, or a placeholder's", async () => {
    // a user from before 5.0: their address stored, never marked verified
    const known = await testPrisma.user.create({
      data: {
        email: "known@example.com",
        accounts: { create: { provider: "google", providerAccountId: "google-known" } },
      },
      select: { id: true },
    });
    const verifiedOf = async (userId: string): Promise<boolean> =>
      (await testPrisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified;
    await upsertOAuthUser(
      testPrisma,
      profile("google-known", "known@example.com", false),
      "google",
    );
    expect(await verifiedOf(known.id)).toBe(false);
    expect(
      await upsertOAuthUser(
        testPrisma,
        profile("google-known", "known@example.com", true),
        "google",
      ),
    ).toBe(known.id);
    expect(await verifiedOf(known.id)).toBe(true);

    // a placeholder becomes the address the provider verifies later
    const placeheld = await upsertOAuthUser(
      testPrisma,
      profile("discord-later", "later@example.com", false),
      "discord",
    );
    if (placeheld === null) throw new Error("expected a user");
    expect(
      await upsertOAuthUser(
        testPrisma,
        profile("discord-later", "later@example.com", true),
        "discord",
      ),
    ).toBe(placeheld);
    expect(await testPrisma.user.findUniqueOrThrow({ where: { id: placeheld } })).toMatchObject({
      email: "later@example.com",
      emailVerified: true,
    });
  });
});

describe("the production allow-list on the sign-in routes and cookie sockets", () => {
  const CODESPACE = "https://someone-else-3000.app.github.dev";
  const WEB = "https://app.example.com";
  let production: TestApp<typeof services>;
  const mockBefore = process.env.ENABLE_MOCK_OAUTH;

  /** Sets one environment variable, or removes it for `undefined`. */
  function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  /** The allowed origins as the API computes them at boot in production. */
  function productionOrigins(): ReturnType<typeof allowedOriginsFromEnv> {
    const nodeEnv = process.env.NODE_ENV;
    const clientUrl = process.env.CLIENT_URL;
    process.env.NODE_ENV = "production";
    process.env.CLIENT_URL = WEB;
    try {
      return allowedOriginsFromEnv();
    } finally {
      setEnv("NODE_ENV", nodeEnv);
      setEnv("CLIENT_URL", clientUrl);
    }
  }

  beforeAll(async () => {
    // the mock provider's start route checks returnTo as every provider's does
    process.env.ENABLE_MOCK_OAUTH = "true";
    const productionAuth = createAppAuth({
      prisma: testPrisma,
      serviceNames,
      jwtSecret: TEST_JWT_SECRET,
      allowedOrigins: productionOrigins(),
    });
    const routes = express();
    routes.use(express.json());
    routes.use(productionAuth.routes);
    production = await createTestApp({
      services,
      db: testDb,
      app: routes,
      auth: productionAuth.server,
    });
  });

  afterAll(async () => {
    await production.close();
    setEnv("ENABLE_MOCK_OAUTH", mockBefore);
  });

  it("refuses a Codespace as a sign-in's returnTo, as any other site", async () => {
    const start = (returnTo: string): Promise<Response> =>
      fetch(`${production.url}/auth/mock/start?returnTo=${encodeURIComponent(returnTo)}`, {
        redirect: "manual",
      });
    expect((await start(WEB)).status).toBe(302);
    expect((await start(CODESPACE)).status).toBe(422);
    expect((await start("https://evil.example.com")).status).toBe(422);
  });

  it("refuses the session cookie on a socket from a Codespace page", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });
    const cookie = `__Host-session=${token}`;
    const { socket, hello } = await connect({}, { cookie, origin: WEB }, production.url);
    expect(hello.userId).toBe(users.regular.id);
    socket.disconnect();

    await expect(connect({}, { cookie, origin: CODESPACE }, production.url)).rejects.toThrow();
  });

  it("refuses the session cookie on an HTTP call from a Codespace page (403)", async () => {
    const { token } = await issueSession(auth.keys, users.regular.id, { provider: "test" });
    const call = (origin: string): Promise<Response> =>
      fetch(`${production.url}/qd/userService/getMe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `__Host-session=${token}`,
          Origin: origin,
        },
        body: "{}",
      });
    expect((await call(WEB)).status).toBe(200);
    expect((await call(CODESPACE)).status).toBe(403);
  });
});

// The list and the start routes are the kit's (its own tests pin the rules:
// the order, the mock only while it is enabled, a provider without
// credentials left out); these pin what this app's configuration answers.
describe("GET /auth/providers: what the login page offers, as the API configures the kit", () => {
  const GOOGLE = { GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret" };
  const DISCORD = { DISCORD_CLIENT_ID: "discord-id", DISCORD_CLIENT_SECRET: "discord-secret" };
  /** What decides the sign-ins: unset unless a test sets it. */
  const SIGN_IN_VARIABLES = [...Object.keys(GOOGLE), ...Object.keys(DISCORD), "ENABLE_MOCK_OAUTH"];

  let api: { url: string; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
    vi.unstubAllEnvs();
  });

  /** The app's sign-in made in this environment, as index.ts mounts it, on a free port. */
  async function serveWith(env: Readonly<Record<string, string>>): Promise<string> {
    for (const name of SIGN_IN_VARIABLES) vi.stubEnv(name, env[name]);
    const appAuth = createTestAuth();
    const routes = express();
    routes.use(appAuth.routes);
    const server = routes.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP port");
    api = {
      url: `http://127.0.0.1:${address.port}`,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      },
    };
    return api.url;
  }

  /** What GET /auth/providers answers, checking that the answer is never cached. */
  async function listed(url: string): Promise<unknown> {
    const response = await fetch(`${url}/auth/providers`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return await response.json();
  }

  /** What the routes answer a sign-in started with `provider`: 302 to it, or 404. */
  async function startStatus(url: string, provider: string): Promise<number> {
    const response = await fetch(`${url}/auth/${provider}/start`, { redirect: "manual" });
    return response.status;
  }

  it("offers the hosted dev instance's demo user (no Google or Discord credentials), and starts only it", async () => {
    // quickdraw-dev.techtree.gg: ENABLE_MOCK_OAUTH on, no provider credentials
    const url = await serveWith({ ENABLE_MOCK_OAUTH: "true" });
    expect(await listed(url)).toEqual({
      providers: [
        { id: "mock", name: "Mock", kind: "mock" },
        // ── quickdraw-game:start ──
        { id: "guest", name: "Guest", kind: "guest" },
        // ── quickdraw-game:end ──
      ],
    });
    expect(await startStatus(url, "mock")).toBe(302);
    expect(await startStatus(url, "google")).toBe(404);
    expect(await startStatus(url, "discord")).toBe(404);
  });

  it("names each provider configured for its button, in the login page's order, and starts each", async () => {
    const url = await serveWith({ ...GOOGLE, ...DISCORD, ENABLE_MOCK_OAUTH: "true" });
    expect(await listed(url)).toEqual({
      providers: [
        { id: "google", name: "Google", kind: "oauth" },
        { id: "discord", name: "Discord", kind: "oauth" },
        { id: "mock", name: "Mock", kind: "mock" },
        // ── quickdraw-game:start ──
        { id: "guest", name: "Guest", kind: "guest" },
        // ── quickdraw-game:end ──
      ],
    });
    for (const provider of ["google", "discord", "mock"]) {
      expect(await startStatus(url, provider)).toBe(302);
    }
  });
});
