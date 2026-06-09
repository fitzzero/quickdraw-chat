import type { Router } from "express";
import {
  createOAuthURL,
  discordProvider,
  exchangeOAuthCode,
  getDiscordAvatarUrl,
  type OAuthConfig,
} from "@fitzzero/quickdraw-core/server";
import { logger } from "../utils/logger.js";
import {
  clientUrl,
  completeOAuthLogin,
  issueOAuthState,
  validateOAuthState,
} from "./oauth-callback.js";

const OAUTH_STATE_COOKIE = "discord_oauth_state";

function discordConfig(): OAuthConfig {
  return {
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    redirectUri: process.env.DISCORD_REDIRECT_URI ?? "http://localhost:4000/auth/discord/callback",
  };
}

/**
 * Register Discord OAuth routes
 */
export function registerDiscordRoutes(router: Router): void {
  router.get("/auth/discord", (_req, res) => {
    const config = discordConfig();
    if (!config.clientId) {
      res.status(500).json({ error: "Discord OAuth not configured" });
      return;
    }

    const state = issueOAuthState(res, OAUTH_STATE_COOKIE);
    res.redirect(createOAuthURL(discordProvider, config, state));
  });

  router.get("/auth/discord/callback", async (req, res) => {
    if (!validateOAuthState(req, res, OAUTH_STATE_COOKIE)) {
      logger.warn("Discord OAuth state mismatch");
      res.redirect(`${clientUrl()}/auth/login?error=invalid_state`);
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${clientUrl()}/auth/login?error=no_code`);
      return;
    }

    try {
      const { tokens, user } = await exchangeOAuthCode(discordProvider, discordConfig(), code);
      await completeOAuthLogin(res, {
        provider: "discord",
        providerAccountId: user.id,
        email: user.email ?? `${user.id}@discord.local`,
        name: user.username,
        image: getDiscordAvatarUrl(user),
        tokens,
      });
    } catch (error) {
      logger.error("Discord OAuth error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.redirect(`${clientUrl()}/auth/login?error=oauth_failed`);
    }
  });
}
