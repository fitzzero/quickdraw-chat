// Guest sign-in (the game's anonymous play): the auth routes kit's guest
// provider over the app's createUser. Deleted with the game by
// scripts/strip-game.mjs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { liveSession } from "@fitzzero/quickdraw-core/server/auth";
import { testPrisma, resetDatabase } from "@project/db/testing";
import { createTestAuth, TEST_WEB_ORIGIN } from "../utils/auth.js";

const auth = createTestAuth();
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(auth.routes);
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

async function createGuest(name: string): Promise<Response> {
  return await fetch(`${baseUrl}/auth/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_WEB_ORIGIN },
    body: JSON.stringify({ name }),
  });
}

/** The session token a response's Set-Cookie carries. */
function cookieToken(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = /(?:^|;\s*|,\s*)(?:__Host-)?session=([^;]+)/.exec(cookie);
  if (!match?.[1]) throw new Error(`no session cookie in ${cookie}`);
  return match[1];
}

describe("Guest auth", () => {
  it("creates a guest user and signs it in with a session cookie", async () => {
    const response = await createGuest("Wandering Snek");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { userId: string; name: string; token: string };
    expect(body.name).toBe("Wandering Snek");

    const user = await testPrisma.user.findUniqueOrThrow({
      where: { id: body.userId },
      select: { isGuest: true, name: true, email: true },
    });
    expect(user).toMatchObject({ isGuest: true, name: "Wandering Snek" });
    expect(user.email).toMatch(/@guest\.local$/);

    // The cookie names a live session of the guest, stored with its provider
    const session = await liveSession(auth.keys, cookieToken(response));
    expect(session?.userId).toBe(body.userId);
    const stored = await testPrisma.session.findUniqueOrThrow({ where: { id: session?.id ?? "" } });
    expect(stored.provider).toBe("guest");

    // The body carries the same session's token, for clients without cookies
    expect((await liveSession(auth.keys, body.token))?.id).toBe(session?.id);
  });

  it("uniquifies colliding names with a numeric tag", async () => {
    expect((await createGuest("Snek")).status).toBe(200);
    const second = await createGuest("Snek");
    expect(second.status).toBe(200);
    // the route answers the name the guest got
    const { userId, name } = (await second.json()) as { userId: string; name: string };
    expect(name).toMatch(/^Snek#\d{4}$/);
    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.name).toBe(name);
  });

  it("refuses invalid names with VALIDATION (422)", async () => {
    for (const name of ["   ", "<script>alert(1)</script>", "x".repeat(50)]) {
      const response = await createGuest(name);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: "VALIDATION" });
    }
    expect(await testPrisma.user.count()).toBe(0);
  });
});
