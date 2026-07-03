/**
 * Discord Activity auth — the Embedded App SDK flow.
 *
 * Inside a Discord Activity iframe the client calls
 * `sdk.commands.authorize()` and receives an authorization code, then POSTs
 * it here (through Discord's proxy: `/.proxy/api/auth/discord/activity`).
 * We exchange the code server-side, upsert the user exactly like the normal
 * Discord OAuth flow (same provider+providerAccountId, so an existing
 * Discord-linked user resolves to the same account), and RETURN the session
 * JWT in the body: third-party cookie restrictions inside the Discord iframe
 * make token-in-handshake the primary auth there (the cookie is still set
 * best-effort).
 *
 * Note: `authorize()` in Activities grants the `identify` scope (no email),
 * so first-time Activity users get a synthetic `<id>@discord.activity`
 * email. Users who previously signed in via regular Discord OAuth match on
 * providerAccountId and keep their real account.
 *
 * Unlike other data, this is REST (not a service method): it must run before
 * any authenticated socket can exist.
 */

import type { Express, Request, Response } from "express";
import type { OAuthTokenResponse } from "@fitzzero/quickdraw-core/server";
import { setSessionCookie } from "@fitzzero/quickdraw-core/server";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";
import { validateRequest, z } from "../utils/validate-request.js";
import { createSessionForProfile } from "./oauth-callback.js";

const activityBodySchema = z.object({
  code: z.string().min(1).max(512),
});

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
}

export interface DiscordActivityDeps {
  /** Exchange the SDK's authorization code for tokens. Injectable for tests. */
  exchangeCode?: (code: string) => Promise<OAuthTokenResponse>;
  /** Fetch the Discord user for an access token. Injectable for tests. */
  fetchDiscordUser?: (accessToken: string) => Promise<DiscordUser>;
  /** Database client override (tests pass testPrisma). */
  db?: PrismaClient;
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

export function registerDiscordActivityRoutes(app: Express, deps: DiscordActivityDeps = {}): void {
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

        const avatar = discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null;

        const { token } = await createSessionForProfile(
          {
            provider: "discord",
            providerAccountId: discordUser.id,
            // Activities grant `identify` only — no email scope
            email: discordUser.email ?? `${discordUser.id}@discord.activity`,
            name: discordUser.global_name ?? discordUser.username,
            image: avatar,
            tokens,
          },
          deps.db,
        );

        // Best-effort cookie for browsers that allow it; the body token is
        // what the Activity client actually uses (socket auth.token).
        setSessionCookie(res, token);
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
