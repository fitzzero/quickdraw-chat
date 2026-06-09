import type { AccessLevel } from "@project/shared";
import { testPrisma } from "@project/db/testing";

let userCounter = 0;

export interface TestUserOverrides {
  email?: string;
  name?: string;
  serviceAccess?: Record<string, AccessLevel>;
}

/**
 * Create a user with a unique email. Default access mirrors a fresh sign-up
 * (no explicit grants — SERVICE_DEFAULT_ACCESS applies at connection time).
 */
export async function createTestUser(
  overrides: TestUserOverrides = {},
): Promise<{ id: string; email: string; name: string | null }> {
  userCounter += 1;
  return testPrisma.user.create({
    data: {
      email: overrides.email ?? `factory-user-${userCounter}@test.com`,
      name: overrides.name ?? `Factory User ${userCounter}`,
      ...(overrides.serviceAccess && { serviceAccess: overrides.serviceAccess }),
    },
    select: { id: true, email: true, name: true },
  });
}
