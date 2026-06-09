import { createRequireAuth } from "@fitzzero/quickdraw-core/server";
import { prisma } from "@project/db";

declare global {
  // oxlint-disable-next-line typescript/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Express middleware that authenticates requests via session cookie or Bearer
 * token. Attaches req.userId on success, returns 401 on failure. Session
 * lookup mirrors the socket auth path so revoked sessions stop authenticating
 * immediately.
 */
export const requireAuth = createRequireAuth({
  getSession: (token) => prisma.session.findUnique({ where: { token } }),
});
