import type { Router } from "express";
import {
  createOAuthURL,
  exchangeOAuthCode,
  googleProvider,
  type OAuthConfig,
} from "@fitzzero/quickdraw-core/server";
import { logger } from "../utils/logger.js";
import {
  clientUrl,
  completeOAuthLogin,
  issueOAuthState,
  validateOAuthState,
} from "./oauth-callback.js";

const OAUTH_STATE_COOKIE = "google_oauth_state";

function googleConfig(): OAuthConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/auth/google/callback",
  };
}

/**
 * Register Google OAuth routes
 */
export function registerGoogleRoutes(router: Router): void {
  router.get("/auth/google", (_req, res) => {
    const config = googleConfig();
    if (!config.clientId) {
      res.status(500).json({ error: "Google OAuth not configured" });
      return;
    }

    const state = issueOAuthState(res, OAUTH_STATE_COOKIE);
    // access_type=offline + prompt=consent: ask Google for a refresh token
    const url = `${createOAuthURL(googleProvider, config, state)}&access_type=offline&prompt=consent`;
    res.redirect(url);
  });

  router.get("/auth/google/callback", async (req, res) => {
    if (!validateOAuthState(req, res, OAUTH_STATE_COOKIE)) {
      logger.warn("Google OAuth state mismatch");
      res.redirect(`${clientUrl()}/auth/login?error=invalid_state`);
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${clientUrl()}/auth/login?error=no_code`);
      return;
    }

    try {
      const { tokens, user } = await exchangeOAuthCode(googleProvider, googleConfig(), code);
      await completeOAuthLogin(res, {
        provider: "google",
        providerAccountId: user.id,
        email: user.email,
        name: user.name,
        image: user.picture,
        tokens,
      });
    } catch (error) {
      logger.error("Google OAuth error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.redirect(`${clientUrl()}/auth/login?error=oauth_failed`);
    }
  });
}
