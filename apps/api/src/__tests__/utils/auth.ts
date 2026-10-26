/**
 * The app's sign-in over the test database, for the auth route tests: the
 * same `createAppAuth` the server builds, with a fixed secret (CI's
 * JWT_SECRET need not be 32 characters) and the web app's dev origin; and a
 * provider's sign-in made as the routes make it (`signIn`).
 */

import type { OAuthTokenResponse } from "@fitzzero/quickdraw-core/server/auth";
import { testDb, testPrisma } from "@project/db/testing";
import { createAppAuth, type AppAuth } from "../../auth/index.js";
import { upsertOAuthUser, type SignInProfile } from "../../auth/users.js";
import { qd } from "../../quickdraw.js";
import { serviceNames } from "../../services/index.js";

/** Signs the test sessions' JWTs: the kit wants 32 characters or more. */
export const TEST_JWT_SECRET = "test-jwt-secret-of-at-least-32-characters";

/** The web app's origin in the tests. */
export const TEST_WEB_ORIGIN = "http://localhost:3000";

export function createTestAuth(
  options: { onRevoke?: (userId: string, sessionId: string | null) => unknown } = {},
): AppAuth {
  return createAppAuth({
    prisma: testPrisma,
    db: testDb,
    serviceNames,
    jwtSecret: TEST_JWT_SECRET,
    allowedOrigins: [TEST_WEB_ORIGIN],
    ...(options.onRevoke ? { onRevoke: options.onRevoke } : {}),
  });
}

const SIGN_IN_TOKENS: OAuthTokenResponse = { access_token: "access", token_type: "Bearer" };

/** A provider's profile for a sign-in, without a name or an image. */
export function signInProfile(
  providerAccountId: string,
  email: string | null,
  emailVerified: boolean,
): SignInProfile {
  return {
    providerAccountId,
    email,
    emailVerified,
    name: null,
    image: null,
    tokens: SIGN_IN_TOKENS,
  };
}

/**
 * A sign-in as the routes make one: `upsertOAuthUser` through the tracked
 * test client, in a unit of work of its own, so its writes reach the test
 * app's subscribers. The user's id, or `null` for a refused sign-in.
 */
export function signIn(profile: SignInProfile, provider: string): Promise<string | null> {
  return qd.run(() => upsertOAuthUser(testDb, profile, provider));
}
