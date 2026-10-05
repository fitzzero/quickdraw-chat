// GET /auth/providers: the sign-ins this API serves, so the login page offers
// those and no others. A provider without credentials is not served (its
// start route answers 404), and the mock only outside production with
// ENABLE_MOCK_OAUTH; the page asks the API rather than read NEXT_PUBLIC_*
// flags, which are baked into the web bundle at build time and drift from
// the server's configuration.
//
// quickdraw-5.0 finding: the auth routes kit does not say which providers it
// serves (createAuthRoutes returns the middleware alone, and decides the mock
// as it mounts it), so the app lists them from the array it gives the kit.
// quickdraw 5.0.0's createAuthRoutes gains GET {basePath}/providers: at that
// bump, drop this route and read the kit's.

import { createPublicApiLimiter } from "@fitzzero/quickdraw-core/server/express";
import type { Express, Request, Response } from "express";
import type { AppAuth } from "./index.js";

/**
 * Serves `GET /auth/providers`: `{ providers: [{ id, kind }] }`, the sign-ins
 * `auth.routes` serve, in order (`kind` is `"oauth"`, `"mock"` or `"guest"`).
 * Public and not cached; the generic public limit (60 a minute per IP).
 * Register it before `auth.routes`, under the app's CORS.
 */
export function registerProvidersRoute(app: Express, auth: Pick<AppAuth, "providers">): void {
  app.get("/auth/providers", createPublicApiLimiter(), (_req: Request, res: Response) => {
    // what is served changes with the server's configuration: never cached
    res.set("Cache-Control", "no-store");
    res.json({ providers: auth.providers() });
  });
}
