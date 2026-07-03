import { Router } from "express";
import { clearSessionCookie, extractBearerOrCookieToken } from "@fitzzero/quickdraw-core/server";
import { verifyJWT } from "./jwt.js";
import { deleteSessionByToken, deleteSessionsForUser } from "./session-store.js";
import { logger } from "../utils/logger.js";

/**
 * Create Express router for auth-related API endpoints.
 */
export function createAuthRouter(): Router {
  const router = Router();

  /**
   * DELETE /auth/logout
   * Logout current session (invalidate the token used in the request)
   */
  router.delete("/auth/logout", async (req, res) => {
    try {
      const token = extractBearerOrCookieToken(req);
      if (!token) {
        res.status(401).json({ error: "Missing authorization" });
        return;
      }

      const payload = await verifyJWT(token);
      if (!payload?.userId) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      const deletedCount = await deleteSessionByToken(token);

      if (deletedCount === 0) {
        // Session already deleted or never existed - still return success
        logger.debug("Logout: session not found", { userId: payload.userId });
      } else {
        logger.info("User logged out", { userId: payload.userId });
      }

      clearSessionCookie(res);
      res.json({ success: true });
    } catch (error) {
      logger.error("Logout error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({ error: "Logout failed" });
    }
  });

  /**
   * DELETE /auth/sessions
   * Logout all devices (invalidate all sessions for the user)
   */
  router.delete("/auth/sessions", async (req, res) => {
    try {
      const token = extractBearerOrCookieToken(req);
      if (!token) {
        res.status(401).json({ error: "Missing authorization" });
        return;
      }

      const payload = await verifyJWT(token);
      if (!payload?.userId) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      const deletedCount = await deleteSessionsForUser(payload.userId);

      logger.info("User logged out all devices", {
        userId: payload.userId,
        sessionsDeleted: deletedCount,
      });

      clearSessionCookie(res);
      res.json({ success: true, sessionsDeleted: deletedCount });
    } catch (error) {
      logger.error("Logout all devices error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({ error: "Logout failed" });
    }
  });

  return router;
}
