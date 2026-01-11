import type { Router } from "express";
import { prisma } from "@project/db";
import { createJWT } from "./jwt.js";
import { logger } from "../utils/logger.js";

interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  verified_email: boolean;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

/**
 * Register Google OAuth routes
 */
export function registerGoogleRoutes(router: Router): void {
  // Redirect to Google OAuth
  router.get("/auth/google", (_req, res) => {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/auth/google/callback";

    if (!GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: "Google OAuth not configured" });
      return;
    }

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // OAuth callback
  router.get("/auth/google/callback", async (req, res) => {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:4000/auth/google/callback";
    const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";

    const code = req.query.code as string | undefined;

    if (!code) {
      res.redirect(`${CLIENT_URL}/auth/login?error=no_code`);
      return;
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: GOOGLE_REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to exchange code for tokens");
      }

      const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

      // Fetch user info
      const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error("Failed to fetch user info");
      }

      const googleUser = (await userResponse.json()) as GoogleUser;

      // Find or create user
      let user = await prisma.user.findFirst({
        where: {
          accounts: {
            some: {
              provider: "google",
              providerAccountId: googleUser.id,
            },
          },
        },
        include: { accounts: true },
      });

      if (!user) {
        // Create new user with account
        user = await prisma.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            image: googleUser.picture,
            accounts: {
              create: {
                provider: "google",
                providerAccountId: googleUser.id,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token ?? null,
                expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
                tokenType: tokens.token_type,
                scope: tokens.scope,
              },
            },
          },
          include: { accounts: true },
        });

        logger.info(`Created new user via Google OAuth: ${user.id}`);
      } else {
        // Update existing account tokens
        await prisma.account.updateMany({
          where: {
            userId: user.id,
            provider: "google",
          },
          data: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? undefined,
            expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
          },
        });

        logger.info(`Updated Google tokens for user: ${user.id}`);
      }

      // Create JWT
      const jwt = await createJWT({
        userId: user.id,
        email: user.email,
      });

      // Redirect to client with token
      res.redirect(`${CLIENT_URL}/auth/callback?token=${jwt}`);
    } catch (error) {
      logger.error("Google OAuth error:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.redirect(`${CLIENT_URL}/auth/login?error=oauth_failed`);
    }
  });
}
