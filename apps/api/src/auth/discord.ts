import type { Router } from "express";
import { prisma } from "@project/db";
import { createJWT } from "./jwt";
import { logger } from "../utils/logger";

interface DiscordUser {
  id: string;
  username: string;
  email: string | null;
  avatar: string | null;
  verified: boolean;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? "http://localhost:3000/auth/callback/discord";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";

/**
 * Register Discord OAuth routes
 */
export function registerDiscordRoutes(router: Router): void {
  // Redirect to Discord OAuth
  router.get("/auth/discord", (_req, res) => {
    if (!DISCORD_CLIENT_ID) {
      res.status(500).json({ error: "Discord OAuth not configured" });
      return;
    }

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify email",
    });

    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });

  // OAuth callback
  router.get("/auth/discord/callback", async (req, res) => {
    const code = req.query.code as string | undefined;

    if (!code) {
      res.redirect(`${CLIENT_URL}/auth/login?error=no_code`);
      return;
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to exchange code for tokens");
      }

      const tokens = (await tokenResponse.json()) as DiscordTokenResponse;

      // Fetch user info
      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error("Failed to fetch user info");
      }

      const discordUser = (await userResponse.json()) as DiscordUser;

      // Find or create user
      let user = await prisma.user.findFirst({
        where: {
          accounts: {
            some: {
              provider: "discord",
              providerAccountId: discordUser.id,
            },
          },
        },
        include: { accounts: true },
      });

      if (!user) {
        // Create new user with account
        user = await prisma.user.create({
          data: {
            email: discordUser.email ?? `${discordUser.id}@discord.local`,
            name: discordUser.username,
            image: discordUser.avatar
              ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
              : null,
            accounts: {
              create: {
                provider: "discord",
                providerAccountId: discordUser.id,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
                tokenType: tokens.token_type,
                scope: tokens.scope,
              },
            },
          },
          include: { accounts: true },
        });

        logger.info(`Created new user via Discord OAuth: ${user.id}`);
      } else {
        // Update existing account tokens
        await prisma.account.updateMany({
          where: {
            userId: user.id,
            provider: "discord",
          },
          data: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
          },
        });

        logger.info(`Updated Discord tokens for user: ${user.id}`);
      }

      // Create JWT
      const jwt = await createJWT({
        userId: user.id,
        email: user.email,
      });

      // Redirect to client with token
      res.redirect(`${CLIENT_URL}/auth/callback?token=${jwt}`);
    } catch (error) {
      logger.error("Discord OAuth error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.redirect(`${CLIENT_URL}/auth/login?error=oauth_failed`);
    }
  });
}
