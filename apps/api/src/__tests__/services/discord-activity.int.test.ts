import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { testPrisma, resetDatabase } from "@project/db/testing";
import { registerDiscordActivityRoutes } from "../../auth/discord-activity.js";

/**
 * The Discord token/user endpoints are stubbed via the deps injection —
 * this tests our side of the flow: code → session mint → { token } body,
 * account linking semantics, and failure handling.
 */
describe("Discord Activity auth", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DISCORD_CLIENT_ID = "test-client-id";
    process.env.DISCORD_CLIENT_SECRET = "test-secret";

    const app = express();
    app.use(express.json());
    registerDiscordActivityRoutes(app, {
      db: testPrisma,
      exchangeCode: async (code) => {
        if (code !== "good-code") throw new Error("bad code");
        return {
          access_token: "access-123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-123",
          scope: "identify",
        };
      },
      fetchDiscordUser: async () => ({
        id: "discord-user-1",
        username: "snakefan",
        global_name: "Snake Fan",
        avatar: null,
      }),
    });

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

  async function exchange(code: string): Promise<Response> {
    return fetch(`${baseUrl}/auth/discord/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  }

  it("exchanges a code for a session token and creates the user + session", async () => {
    const response = await exchange("good-code");
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    expect(token).toBeTruthy();

    const user = await testPrisma.user.findFirst({
      where: { accounts: { some: { provider: "discord", providerAccountId: "discord-user-1" } } },
      select: { id: true, email: true, name: true },
    });
    expect(user?.name).toBe("Snake Fan");
    // identify scope has no email → synthetic address
    expect(user?.email).toBe("discord-user-1@discord.activity");

    const session = await testPrisma.session.findUnique({ where: { token } });
    expect(session?.userId).toBe(user?.id);
  });

  it("reuses the same user across repeated activity logins", async () => {
    await exchange("good-code");
    await exchange("good-code");

    const count = await testPrisma.user.count({
      where: { accounts: { some: { provider: "discord", providerAccountId: "discord-user-1" } } },
    });
    expect(count).toBe(1);
  });

  it("links to an existing user who signed in via regular Discord OAuth", async () => {
    const existing = await testPrisma.user.create({
      data: {
        email: "real@person.dev",
        name: "Real Person",
        accounts: {
          create: { provider: "discord", providerAccountId: "discord-user-1" },
        },
      },
      select: { id: true },
    });

    const response = await exchange("good-code");
    const { token } = (await response.json()) as { token: string };
    const session = await testPrisma.session.findUnique({ where: { token } });
    expect(session?.userId).toBe(existing.id);
  });

  it("rejects bad codes with 401 and malformed bodies with 400", async () => {
    const bad = await exchange("wrong-code");
    expect(bad.status).toBe(401);

    const malformed = await fetch(`${baseUrl}/auth/discord/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(malformed.status).toBe(400);
  });
});
