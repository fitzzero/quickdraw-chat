import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "@project/db/testing";
import { deleteExpiredSessions } from "../../auth/session-store.js";
import { createTestUser } from "../factories/user-factory.js";

describe("Expired-session cleanup", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("deletes only sessions past their expiry", async () => {
    const user = await createTestUser();
    const now = new Date();

    await testPrisma.session.createMany({
      data: [
        {
          userId: user.id,
          token: "expired-token",
          expiresAt: new Date(now.getTime() - 60 * 1000),
        },
        {
          userId: user.id,
          token: "live-token",
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      ],
    });

    const deleted = await deleteExpiredSessions(now, testPrisma);
    expect(deleted).toBe(1);

    const remaining = await testPrisma.session.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.token).toBe("live-token");
  });

  it("is a no-op when nothing is expired", async () => {
    const user = await createTestUser();
    await testPrisma.session.create({
      data: {
        userId: user.id,
        token: "live-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const deleted = await deleteExpiredSessions(new Date(), testPrisma);
    expect(deleted).toBe(0);
  });
});
