import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "@project/db/testing";
import { deleteExpiredSessions } from "../../auth/sessions.js";
import { createTestUser } from "../factories/user-factory.js";

describe("Expired-session cleanup", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("deletes only sessions past their expiry", async () => {
    const user = await createTestUser();
    const now = new Date();

    const [expired, live] = await Promise.all([
      testPrisma.session.create({
        data: { userId: user.id, provider: "mock", expiresAt: new Date(now.getTime() - 60 * 1000) },
      }),
      testPrisma.session.create({
        data: {
          userId: user.id,
          provider: "mock",
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      }),
    ]);

    const deleted = await deleteExpiredSessions(testPrisma, now);
    expect(deleted).toBe(1);

    const remaining = await testPrisma.session.findMany({ where: { userId: user.id } });
    expect(remaining.map((session) => session.id)).toEqual([live.id]);
    expect(remaining.some((session) => session.id === expired.id)).toBe(false);
  });

  it("is a no-op when nothing is expired", async () => {
    const user = await createTestUser();
    await testPrisma.session.create({
      data: {
        userId: user.id,
        provider: "mock",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const deleted = await deleteExpiredSessions(testPrisma, new Date());
    expect(deleted).toBe(0);
  });
});
