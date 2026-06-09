import type { Express } from "express";
import {
  createMockOAuthProvider,
  createOAuthURL,
  exchangeOAuthCode,
  isMockOAuthEnabled,
  registerMockOAuthProvider,
  type MockOAuthUser,
  type OAuthConfig,
  type OAuthProvider,
} from "@fitzzero/quickdraw-core/server";
import type { GoogleUser } from "@fitzzero/quickdraw-core/server";
import { prisma } from "@project/db";
import { logger } from "../utils/logger.js";
import {
  clientUrl,
  completeOAuthLogin,
  issueOAuthState,
  validateOAuthState,
} from "./oauth-callback.js";

const OAUTH_STATE_COOKIE = "mock_oauth_state";

function backendPort(): string {
  return String(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);
}

/** Public URL the browser uses to reach the API (codespace/LAN aware). */
function apiUrl(): string {
  return process.env.API_URL ?? `http://localhost:${backendPort()}`;
}

function mockProvider(): OAuthProvider<GoogleUser> {
  // Token/userinfo exchanges are server-side self-fetches: always loopback,
  // since the public URL may not be reachable from inside the container.
  return createMockOAuthProvider(apiUrl(), {
    internalBaseUrl: `http://localhost:${backendPort()}`,
  });
}

function mockConfig(): OAuthConfig {
  return {
    clientId: "mock",
    clientSecret: "mock",
    redirectUri: `${apiUrl()}/auth/mock/callback`,
  };
}

/** Seeded users surfaced in the mock sign-in picker. */
async function listMockUsers(): Promise<MockOAuthUser[]> {
  const users = await prisma.user.findMany({
    take: 20,
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, image: true },
  });
  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name ?? user.email,
    picture: user.image,
  }));
}

/**
 * Register the mock OAuth flow: the provider endpoints (authorize/token/
 * userinfo, served by core) plus the app-side legs mirroring google.ts.
 *
 * Dev-only: no-ops entirely unless ENABLE_MOCK_OAUTH=true outside production
 * (and index.ts refuses to boot in production with the flag set).
 */
export function registerMockRoutes(app: Express): void {
  if (!isMockOAuthEnabled()) return;

  const mounted = registerMockOAuthProvider(app, { listUsers: listMockUsers, logger });
  if (!mounted) return;

  app.get("/auth/mock", (_req, res) => {
    const state = issueOAuthState(res, OAUTH_STATE_COOKIE);
    res.redirect(createOAuthURL(mockProvider(), mockConfig(), state));
  });

  app.get("/auth/mock/callback", async (req, res) => {
    if (!validateOAuthState(req, res, OAUTH_STATE_COOKIE)) {
      logger.warn("Mock OAuth state mismatch");
      res.redirect(`${clientUrl()}/auth/login?error=invalid_state`);
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${clientUrl()}/auth/login?error=no_code`);
      return;
    }

    try {
      const { tokens, user } = await exchangeOAuthCode(mockProvider(), mockConfig(), code);
      await completeOAuthLogin(res, {
        provider: "mock",
        // providerAccountId is the email (stable across re-seeds)
        providerAccountId: user.id,
        email: user.email,
        name: user.name,
        image: user.picture,
        tokens,
      });
    } catch (error) {
      logger.error("Mock OAuth error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.redirect(`${clientUrl()}/auth/login?error=oauth_failed`);
    }
  });

  logger.info("Mock OAuth login enabled at /auth/mock (development only)");
}
