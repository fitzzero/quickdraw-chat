/**
 * The app's sign-in over the test database, for the auth route tests: the
 * same `createAppAuth` the server builds, with a fixed secret (CI's
 * JWT_SECRET need not be 32 characters) and the web app's dev origin.
 */

import { testPrisma } from "@project/db/testing";
import { createAppAuth, type AppAuth } from "../../auth/index.js";
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
    serviceNames,
    jwtSecret: TEST_JWT_SECRET,
    allowedOrigins: [TEST_WEB_ORIGIN],
    ...(options.onRevoke ? { onRevoke: options.onRevoke } : {}),
  });
}
