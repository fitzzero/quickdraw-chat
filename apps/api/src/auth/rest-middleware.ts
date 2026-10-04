import type { RequestHandler } from "express";
import {
  createRequireAuth,
  liveSession,
  type SessionKeys,
} from "@fitzzero/quickdraw-core/server/auth";

declare global {
  // oxlint-disable-next-line typescript/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * The REST auth middleware: the session cookie (or a bearer token) must
 * stand for a live session in the auth routes' store, exactly as on a
 * socket, so a signed-out session stops authenticating REST calls at once.
 * Attaches `req.userId` on success, answers 401 otherwise.
 */
export function createRestRequireAuth(keys: SessionKeys): RequestHandler {
  const requireAuth = createRequireAuth({
    jwtSecret: keys.jwtSecret,
    // quickdraw-5.0 finding: createRequireAuth is 4.1's token-keyed middleware: with the auth routes kit's sessions (the JWT names its session, `sid`) an app hands it liveSession, which verifies the JWT a second time; the kit has no REST middleware of its own over SessionKeys
    getSession: (token) => liveSession(keys, token),
  });
  return (req, res, next) => {
    void requireAuth(req, res, next);
  };
}
