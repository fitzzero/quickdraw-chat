// Where signed-in sessions live: the auth routes kit's SessionStore over the
// Session table. Sessions are not live data, so they are written through the
// untracked client (nobody subscribes to them); the routes revoke a row at
// logout, and `socketAuth` reads it on every handshake, so a revoked session
// stops authenticating at once.

import type { AuthSession, SessionStore } from "@fitzzero/quickdraw-core/server/auth";
import type { PrismaClient } from "@project/db";

const SESSION_FIELDS = { id: true, userId: true, expiresAt: true } as const;

/** The SessionStore over `client`'s Session table. */
export function prismaSessions(client: PrismaClient): SessionStore {
  return {
    create: (userId, meta): Promise<AuthSession> =>
      client.session.create({
        data: {
          userId,
          provider: meta.provider,
          expiresAt: meta.expiresAt,
          userAgent: meta.userAgent ?? null,
          ip: meta.ip ?? null,
        },
        select: SESSION_FIELDS,
      }),
    get: (id) => client.session.findUnique({ where: { id }, select: SESSION_FIELDS }),
    revoke: (id) => client.session.deleteMany({ where: { id } }),
    revokeAll: (userId) => client.session.deleteMany({ where: { userId } }),
  };
}

/**
 * Delete all sessions past their expiry. Returns deleted count.
 * Expired rows are already refused at sign-in time — this is hygiene so the
 * table doesn't grow unbounded (run periodically, see index.ts).
 */
export async function deleteExpiredSessions(
  client: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const result = await client.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return result.count;
}
