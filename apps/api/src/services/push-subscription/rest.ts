/**
 * REST endpoint for service-worker push subscription renewal.
 *
 * When a push subscription expires, the browser fires `pushsubscriptionchange`
 * inside the service worker — which has no Socket.IO connection — so this is
 * one of the few legitimate REST surfaces (see api-conventions.md). The
 * session cookie rides along on the fetch, authenticated the same way as the
 * socket path (createRestRequireAuth from auth/rest-middleware.ts, with an
 * injectable db so tests can point it at testPrisma).
 */

import type { Express, Request, Response } from "express";
import type { PrismaClient } from "@project/db";
import { createRestRequireAuth } from "../../auth/rest-middleware.js";
import { logger } from "../../utils/logger.js";
import { validateRequest, z } from "../../utils/validate-request.js";
import type { PushService } from "./index.js";

const resubscribeBodySchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

export interface PushRestDeps {
  /** Database client override (tests pass testPrisma). */
  db?: PrismaClient;
}

export function registerPushRoutes(
  app: Express,
  pushService: PushService,
  deps: PushRestDeps = {},
): void {
  const requireAuth = createRestRequireAuth(deps.db);

  app.post("/api/push/resubscribe", requireAuth, (req: Request, res: Response) => {
    void (async () => {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Missing or invalid authorization" });
        return;
      }

      const body = validateRequest(resubscribeBodySchema, req.body, res);
      if (!body) return;

      try {
        await pushService.resubscribe(userId, body.endpoint, body.keys);
        res.json({ success: true });
      } catch (error) {
        logger.error("Push resubscribe failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: "Internal server error" });
      }
    })();
  });
}
