/**
 * Discord Activity auth — the Embedded App SDK flow.
 *
 * Inside a Discord Activity iframe the client calls
 * `sdk.commands.authorize()` and receives an authorization code, then POSTs
 * it here (through Discord's proxy: `/.proxy/api/auth/discord/activity`).
 * We exchange the code server-side, find or create the user exactly like the
 * Discord sign-in route (same provider+providerAccountId, so an existing
 * Discord-linked user resolves to the same account), start a session on the
 * auth routes kit's store (`issueSession`), and RETURN its JWT in the body:
 * the Activity's page and its Godot client sign in with it
 * (token-in-handshake, `auth.token`). No cookie is set: the page never
 * sends one (an iframe on Discord's site rarely keeps it), and a cookie is
 * only for a page that calls the API with it.
 *
 * Note: `authorize()` in Activities grants the `identify` scope (no email),
 * so first-time Activity users get the placeholder address
 * `<id>@discord.local` (as any sign-in without a verified email does, see
 * `upsertOAuthUser`). Users who previously signed in via regular Discord
 * OAuth match on providerAccountId and keep their real account.
 *
 * An app route rather than an auth routes kit provider: the kit's providers
 * redirect, and this flow answers a POST from the Activity's own page.
 */

import type { Express, Request, Response } from "express";
import {
  issueSession,
  type OAuthTokenResponse,
  type SessionKeys,
} from "@fitzzero/quickdraw-core/server/auth";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";
import { validateRequest, z } from "../utils/validate-request.js";
import { upsertOAuthUser } from "./users.js";

/** How long an Activity session lasts: the auth routes' default, 7 days. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const activityBodySchema = z.object({
  code: z.string().min(1).max(512),
});

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
  verified?: boolean;
}

export interface DiscordActivityDeps {
  /** Where sessions are stored and the secret their JWTs are signed with: the auth routes'. */
  keys: SessionKeys;
  /** The database users are found or created in. */
  db: PrismaClient;
  /** Exchange the SDK's authorization code for tokens. Injectable for tests. */
  exchangeCode?: (code: string) => Promise<OAuthTokenResponse>;
  /** Fetch the Discord user for an access token. Injectable for tests. */
  fetchDiscordUser?: (accessToken: string) => Promise<DiscordUser>;
}

async function defaultExchangeCode(code: string): Promise<OAuthTokenResponse> {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!response.ok) {
    throw new Error(`Discord token exchange failed (${response.status})`);
  }
  return (await response.json()) as OAuthTokenResponse;
}

async function defaultFetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Discord user fetch failed (${response.status})`);
  }
  return (await response.json()) as DiscordUser;
}

export function registerDiscordActivityRoutes(app: Express, deps: DiscordActivityDeps): void {
  const exchangeCode = deps.exchangeCode ?? defaultExchangeCode;
  const fetchDiscordUser = deps.fetchDiscordUser ?? defaultFetchDiscordUser;

  app.post("/auth/discord/activity", (req: Request, res: Response) => {
    void (async () => {
      if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
        res.status(501).json({ error: "Discord OAuth is not configured" });
        return;
      }

      const body = validateRequest(activityBodySchema, req.body, res);
      if (!body) return;

      try {
        const tokens = await exchangeCode(body.code);
        const discordUser = await fetchDiscordUser(tokens.access_token);
        const userId = await upsertOAuthUser(
          deps.db,
          {
            providerAccountId: discordUser.id,
            // Activities grant `identify` only, so no email: the user gets the
            // placeholder address, as for an email Discord did not verify
            email: discordUser.email ?? null,
            emailVerified: discordUser.verified === true,
            name: discordUser.global_name ?? discordUser.username,
            image: discordUser.avatar
              ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
              : null,
            tokens,
          },
          "discord",
        );
        if (userId === null) {
          res.status(401).json({ error: "Discord Activity authentication failed" });
          return;
        }
        const { token } = await issueSession(
          deps.keys,
          userId,
          { provider: "discord-activity", userAgent: req.get("user-agent"), ip: req.ip },
          SESSION_TTL_MS,
        );
        // The Activity signs in with the body's token (its socket's and the
        // Godot client's auth.token): no cookie, which its page never uses
        // (quickdraw's guide since 5.0.0-rc.6 sets none here either)
        res.json({ token });
      } catch (error) {
        logger.warn("Discord Activity auth failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(401).json({ error: "Discord Activity authentication failed" });
      }
    })();
  });
}
