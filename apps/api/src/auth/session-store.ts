import { prisma, type PrismaClient } from "@project/db";

/**
 * Session persistence helpers for the auth REST routes.
 * Route handlers stay free of direct Prisma access (see
 * project/no-prisma-in-routes).
 */

/** Delete the session matching a specific token. Returns deleted count. */
export async function deleteSessionByToken(token: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { token },
  });
  return result.count;
}

/** Delete all sessions for a user (logout all devices). Returns deleted count. */
export async function deleteSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete all sessions past their expiry. Returns deleted count.
 * Expired rows are already rejected at auth time — this is hygiene so the
 * table doesn't grow unbounded (run periodically, see index.ts).
 */
export async function deleteExpiredSessions(
  now: Date = new Date(),
  db: PrismaClient = prisma,
): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
