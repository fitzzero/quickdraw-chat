import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { testPrisma, resetDatabase } from "@project/db/testing";
import { registerGuestRoutes } from "../../auth/guest.js";

describe("Guest auth", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerGuestRoutes(app, { db: testPrisma });

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
    return fetch(`${baseUrl}/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  it("creates a guest user, session, and cookie", async () => {
    const response = await createGuest("Wandering Snek");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { userId: string; name: string };
    expect(body.name).toBe("Wandering Snek");
    expect(response.headers.get("set-cookie")).toContain("session=");

    const user = await testPrisma.user.findUnique({
      where: { id: body.userId },
      select: { isGuest: true, name: true, email: true },
    });
    expect(user?.isGuest).toBe(true);
    expect(user?.email).toMatch(/@guest\.local$/);

    const session = await testPrisma.session.findFirst({ where: { userId: body.userId } });
    expect(session).toBeTruthy();
  });

  it("uniquifies colliding names with a numeric tag", async () => {
    const first = await createGuest("Snek");
    expect(first.status).toBe(200);

    const second = await createGuest("Snek");
    expect(second.status).toBe(200);
    const body = (await second.json()) as { name: string };
    expect(body.name).toMatch(/^Snek#\d{4}$/);
  });

  it("rejects invalid names with 400", async () => {
    const empty = await createGuest("   ");
    expect(empty.status).toBe(400);

    const evil = await createGuest("<script>alert(1)</script>");
    expect(evil.status).toBe(400);

    const tooLong = await createGuest("x".repeat(50));
    expect(tooLong.status).toBe(400);
  });
});
