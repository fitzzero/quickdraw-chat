/**
 * REST endpoint for service-worker push subscription renewal.
 *
 * When a push subscription expires, the browser fires `pushsubscriptionchange`
 * inside the service worker — which has no Socket.IO connection — so this is
 * one of the few legitimate REST surfaces (see api-conventions.md). The
 * session cookie rides along on the fetch and must stand for a live session,
 * exactly as on a socket (createRestRequireAuth). The renewal itself is the
 * subscribePush method, called in process as the session's user, so its
 * validation, access check and tracked write are the socket path's.
 */

import { QuickdrawError } from "@fitzzero/quickdraw-core";
import type { SessionKeys } from "@fitzzero/quickdraw-core/server/auth";
import type { Express, Request, Response } from "express";
import { createRestRequireAuth } from "../../auth/rest-middleware.js";
import { qd } from "../../quickdraw.js";
import { logger } from "../../utils/logger.js";
import { validateRequest } from "../../utils/validate-request.js";
import { pushSubscriptionSchema } from "./schemas.js";

export function registerPushRoutes(app: Express, keys: SessionKeys): void {
  const requireAuth = createRestRequireAuth(keys);

  app.post("/api/push/resubscribe", requireAuth, (req: Request, res: Response) => {
    void (async () => {
      const { userId } = req;
      if (!userId) {
        res.status(401).json({ error: "Missing or invalid authorization" });
        return;
      }

      const body = validateRequest(pushSubscriptionSchema, req.body, res);
      if (!body) return;

      try {
        await qd.caller({ userId }).pushService.subscribePush(body);
        res.json({ success: true });
      } catch (error) {
        logger.error("Push resubscribe failed", {
          error: error instanceof QuickdrawError ? error.code : String(error),
        });
        res.status(500).json({ error: "Internal server error" });
      }
    })();
  });
}
