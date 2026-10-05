// The app's own user records for sign-in: `onLogin` finds or creates the user
// a provider's profile stands for (and its Account row, tokens encrypted at
// rest), and the mock provider's picker lists the seeded demo users. Written
// through the untracked client: a user signing in has no subscribers yet.

import { encrypt } from "@fitzzero/quickdraw-core/server";
import type { AuthProfile, MockOAuthUser } from "@fitzzero/quickdraw-core/server/auth";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";
import { safeImageUrl } from "../utils/safe-image-url.js";

/**
 * Encrypt an OAuth token for at-rest storage when ENCRYPTION_KEY is
 * configured; store plaintext otherwise (local dev without a key).
 */
function maybeEncrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  return process.env.ENCRYPTION_KEY ? encrypt(value) : value;
}

/** A provider's profile, as the sign-in routes (the kit's and the app's own) report it. */
export type SignInProfile = Pick<
  AuthProfile,
  "providerAccountId" | "email" | "emailVerified" | "name" | "image" | "tokens"
>;

/**
 * The address a user gets when their provider verified none:
 * `<providerAccountId>@<provider>.local`. No provider verifies a `.local`
 * address, so it never links another sign-in or matches ADMIN_EMAILS.
 */
export function placeholderEmail(providerAccountId: string, provider: string): string {
  return `${providerAccountId}@${provider}.local`;
}

/** Prisma's unique-constraint violation: another user holds the address. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

interface KnownUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * A known user signs in again: when their provider now verifies an address
 * for them, record it. Their stored address is marked verified; the
 * placeholder this account was given is replaced by the verified address,
 * unless another user holds it. Never marks anything unverified.
 */
async function recordVerifiedEmail(
  prisma: PrismaClient,
  user: KnownUser,
  verified: string | null,
  placeholder: string,
): Promise<void> {
  if (verified === null || (user.emailVerified && user.email === verified)) return;
  if (user.email === verified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
      select: { id: true },
    });
    return;
  }
  if (user.email !== placeholder) return;
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { email: verified, emailVerified: true },
      select: { id: true },
    });
  } catch (error) {
    // another user holds the verified address: the placeholder stays
    if (!isUniqueViolation(error)) throw error;
  }
}

/**
 * Finds or creates the user `profile` signs in, and stores the provider's
 * tokens on its Account row; returns the user's id, or `null` to refuse.
 *
 * - A known provider account signs its user in (and records an address its
 *   provider now verifies, see `recordVerifiedEmail`).
 * - An address the provider did not verify is never stored, linked or
 *   matched against ADMIN_EMAILS (anyone can type someone else's): the new
 *   user gets `placeholderEmail` instead.
 * - A verified address links the user who holds it (a seeded or
 *   pre-provisioned user, or one adding a second provider), unless someone
 *   signed in to that user before without a provider verifying the address
 *   (any address was stored before 5.0): then the sign-in is refused, as
 *   linking could hand it that account. Otherwise a user is created with
 *   the address, verified.
 */
export async function upsertOAuthUser(
  prisma: PrismaClient,
  profile: SignInProfile,
  provider: string,
): Promise<string | null> {
  const { providerAccountId, tokens } = profile;
  const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;
  // The address this sign-in may use for the user: one its provider verified
  const verified = profile.emailVerified && profile.email ? profile.email : null;
  const placeholder = placeholderEmail(providerAccountId, provider);

  const existing = await prisma.user.findFirst({
    where: { accounts: { some: { provider, providerAccountId } } },
    select: { id: true, email: true, emailVerified: true },
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
    await recordVerifiedEmail(prisma, existing, verified, placeholder);
    logger.info(`Updated ${provider} tokens`, { userId: existing.id });
    return existing.id;
  }

  const account = {
    provider,
    providerAccountId,
    accessToken: maybeEncrypt(tokens.access_token),
    refreshToken: maybeEncrypt(tokens.refresh_token),
    expiresAt,
    tokenType: tokens.token_type,
    scope: tokens.scope,
  };
  // One statement with its account: users are written untracked here (no
  // subscriber can exist before the first sign-in)
  const newUser = {
    name: profile.name,
    image: safeImageUrl(profile.image),
    accounts: { create: account },
  };

  if (verified === null) {
    const created = await prisma.user.create({
      data: { ...newUser, email: placeholder },
      select: { id: true },
    });
    logger.info(`Created new user via ${provider} sign-in, without a verified email`, {
      userId: created.id,
    });
    return created.id;
  }

  const byEmail = await prisma.user.findUnique({
    where: { email: verified },
    select: { id: true, emailVerified: true, accounts: { select: { id: true }, take: 1 } },
  });
  if (byEmail) {
    if (!byEmail.emailVerified && byEmail.accounts.length > 0) {
      logger.warn(
        `Refused ${provider} sign-in: its verified email is held by a user no provider verified it for`,
        { userId: byEmail.id },
      );
      return null;
    }
    await prisma.account.create({ data: { ...account, userId: byEmail.id }, select: { id: true } });
    if (!byEmail.emailVerified) {
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { emailVerified: true },
        select: { id: true },
      });
    }
    logger.info(`Linked ${provider} account to existing user`, { userId: byEmail.id });
    return byEmail.id;
  }

  const created = await prisma.user.create({
    data: { ...newUser, email: verified, emailVerified: true },
    select: { id: true },
  });
  logger.info(`Created new user via ${provider} sign-in`, { userId: created.id });
  return created.id;
}

/** The seeded users the mock sign-in picker offers (`bun run db:seed`). */
export async function listMockUsers(prisma: PrismaClient): Promise<MockOAuthUser[]> {
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
