import { Router } from "express";
import { prisma } from "@project/db";
import { verifyJWT } from "./jwt.js";
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
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing authorization header" });
        return;
      }

      const token = authHeader.slice(7);
      const payload = await verifyJWT(token);

      if (!payload?.userId) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      // Delete the specific session
      const result = await prisma.session.deleteMany({
        where: { token },
      });

      if (result.count === 0) {
        // Session already deleted or never existed - still return success
        logger.debug("Logout: session not found", { userId: payload.userId });
      } else {
        logger.info("User logged out", { userId: payload.userId });
      }

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
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing authorization header" });
        return;
      }

      const token = authHeader.slice(7);
      const payload = await verifyJWT(token);

      if (!payload?.userId) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      // Delete all sessions for this user
      const result = await prisma.session.deleteMany({
        where: { userId: payload.userId },
      });

      logger.info("User logged out all devices", {
        userId: payload.userId,
        sessionsDeleted: result.count,
      });

      res.json({ success: true, sessionsDeleted: result.count });
    } catch (error) {
      logger.error("Logout all devices error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({ error: "Logout failed" });
    }
  });

  return router;
}
