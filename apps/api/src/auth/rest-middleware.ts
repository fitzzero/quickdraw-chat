import type { RequestHandler } from "express";
import { createRequireAuth } from "@fitzzero/quickdraw-core/server";
import { prisma as defaultPrisma, type PrismaClient } from "@project/db";

declare global {
  // oxlint-disable-next-line typescript/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Build the REST auth middleware against a specific database client.
 *
 * Every REST surface authenticates the same way; the only thing that varies is
 * the client (tests point it at testPrisma). Use this factory rather than
 * calling core's `createRequireAuth` again, so there is one session-lookup
 * path to audit.
 */
export function createRestRequireAuth(db: PrismaClient = defaultPrisma): RequestHandler {
  return createRequireAuth({
    getSession: (token) => db.session.findUnique({ where: { token } }),
  });
}

/**
 * Express middleware that authenticates requests via session cookie or Bearer
 * token. Attaches req.userId on success, returns 401 on failure. Session
 * lookup mirrors the socket auth path so revoked sessions stop authenticating
 * immediately.
 */
export const requireAuth: RequestHandler = createRestRequireAuth();
