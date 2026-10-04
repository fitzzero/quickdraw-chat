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
 * Finds or creates the user `profile` signs in, and stores the provider's
 * tokens on its Account row; returns the user's id, or `null` to refuse. A
 * known provider account signs its user in; otherwise an existing user with
 * the profile's email is linked (seeded demo users, a second provider) when
 * the provider verified that email, and the sign-in is refused when it did
 * not (an unverified email would hand over that user's account); otherwise a
 * user is created. A
 * profile without an email gets `<id>@<provider>.local`.
 */
export async function upsertOAuthUser(
  prisma: PrismaClient,
  profile: SignInProfile,
  provider: string,
): Promise<string | null> {
  const { providerAccountId, tokens } = profile;
  const expiresAt = tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null;

  const existing = await prisma.user.findFirst({
    where: { accounts: { some: { provider, providerAccountId } } },
    select: { id: true },
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
  const email = profile.email ?? `${providerAccountId}@${provider}.local`;

  // Link by email when the user exists without this provider — covers seeded
  // demo users and users adding a second OAuth provider.
  const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (byEmail) {
    if (!profile.emailVerified) {
      logger.warn(`Refused ${provider} sign-in: unverified email of an existing user`);
      return null;
    }
    await prisma.account.create({ data: { ...account, userId: byEmail.id } });
    logger.info(`Linked ${provider} account to existing user`, { userId: byEmail.id });
    return byEmail.id;
  }

  // One statement with its account: users are written untracked here (no
  // subscriber can exist before the first sign-in)
  const created = await prisma.user.create({
    data: {
      email,
      name: profile.name,
      image: safeImageUrl(profile.image),
      accounts: { create: account },
    },
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
