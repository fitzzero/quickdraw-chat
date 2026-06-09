import crypto from "crypto";
import type { Request, Response } from "express";
import {
  encrypt,
  setSessionCookie,
  type OAuthTokenResponse,
} from "@fitzzero/quickdraw-core/server";
import { prisma } from "@project/db";
import { createJWT } from "./jwt.js";
import { logger } from "../utils/logger.js";

const SESSION_EXPIRY_DAYS = 7;
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:3000";
}

/**
 * Encrypt an OAuth token for at-rest storage when ENCRYPTION_KEY is
 * configured; store plaintext otherwise (local dev without a key).
 */
function maybeEncrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  return process.env.ENCRYPTION_KEY ? encrypt(value) : value;
}

/**
 * Issue a CSRF state parameter and persist it in a short-lived httpOnly cookie.
 */
export function issueOAuthState(res: Response, cookieName: string): string {
  const state = crypto.randomBytes(32).toString("hex");
  res.cookie(cookieName, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE_MS,
  });
  return state;
}

/**
 * Validate the callback's state parameter against the stored cookie.
 * Clears the cookie regardless of outcome.
 */
export function validateOAuthState(req: Request, res: Response, cookieName: string): boolean {
  const state = req.query.state as string | undefined;
  const storedState = (req.cookies as Record<string, string> | undefined)?.[cookieName];
  res.clearCookie(cookieName);
  return Boolean(state && storedState && state === storedState);
}

export interface OAuthProfile {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  image: string | null;
  tokens: OAuthTokenResponse;
}

/**
 * Shared OAuth callback tail for all providers: find-or-create the user and
 * account, persist (optionally encrypted) provider tokens, create a JWT +
 * session row (token revocation support), set the session cookie, and
 * redirect to the web client's auth callback page.
 */
async function findOrCreateUser(
  profile: OAuthProfile,
  expiresAt: number | null,
): Promise<{ id: string; email: string }> {
  const { provider, providerAccountId, tokens } = profile;

  const existing = await prisma.user.findFirst({
    where: { accounts: { some: { provider, providerAccountId } } },
    select: { id: true, email: true },
  });

  if (existing) {
    await prisma.account.updateMany({
      where: { userId: existing.id, provider },
      data: {
        accessToken: maybeEncrypt(tokens.access_token),
        refreshToken: maybeEncrypt(tokens.refresh_token) ?? undefined,
        expiresAt,
      },
    });
    logger.info(`Updated ${provider} tokens`, { userId: existing.id });
    return existing;
  }

  const accountData = {
    provider,
    providerAccountId,
    accessToken: maybeEncrypt(tokens.access_token),
    refreshToken: maybeEncrypt(tokens.refresh_token),
    expiresAt,
    tokenType: tokens.token_type,
    scope: tokens.scope,
  };

  // Link by verified email when the user exists without this provider —
  // covers seeded demo users and users adding a second OAuth provider.
  const byEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: { id: true, email: true },
  });
  if (byEmail) {
    await prisma.account.create({ data: { ...accountData, userId: byEmail.id } });
    logger.info(`Linked ${provider} account to existing user`, { userId: byEmail.id });
    return byEmail;
  }

  const created = await prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      image: profile.image,
      accounts: { create: accountData },
    },
    select: { id: true, email: true },
  });
  logger.info(`Created new user via ${provider} OAuth`, { userId: created.id });
  return created;
}

export async function completeOAuthLogin(res: Response, profile: OAuthProfile): Promise<void> {
  const { tokens } = profile;
  const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;

  const user = await findOrCreateUser(profile, expiresAt);

  const jwt = await createJWT({ userId: user.id, email: user.email });

  await prisma.session.create({
    data: {
      userId: user.id,
      token: jwt,
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  // Cookie-based auth for same-site/REST flows; the token in the redirect URL
  // feeds the client-side socket auth (stored by the /auth/callback page).
  setSessionCookie(res, jwt);
  res.redirect(`${clientUrl()}/auth/callback?token=${jwt}`);
}
