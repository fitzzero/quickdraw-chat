import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { resetDatabase as coreResetDatabase } from "@fitzzero/quickdraw-core/server/testing/prisma";

let _testPrisma: PrismaClient | undefined;

/**
 * Inject a PrismaClient instance for the current worker.
 * Called by PGlite-based test setup to replace the default Postgres-backed client.
 */
export function setTestPrisma(client: PrismaClient): void {
  _testPrisma = client;
}

function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "No test database configured. Either call setTestPrisma() with a PGlite-backed client, " +
          "or set TEST_DATABASE_URL / DATABASE_URL environment variable.",
      );
    }
    const adapter = new PrismaPg({ connectionString });
    _testPrisma = new PrismaClient({ adapter, log: ["error"] });
  }
  return _testPrisma;
}

// Lazy proxy: resolves the client on first use so PGlite setup can inject
// before anything touches the database.
export const testPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(getTestPrisma(), prop);
  },
});

/**
 * Reset the test database by truncating all public tables (dynamic discovery,
 * deadlock retry — see quickdraw-core/server/testing/prisma).
 */
export async function resetDatabase(): Promise<void> {
  await coreResetDatabase(testPrisma);
}

/**
 * Seed test users with specific service access levels.
 */
export async function seedTestUsers(): Promise<{
  admin: { id: string; email: string };
  moderator: { id: string; email: string };
  regular: { id: string; email: string };
}> {
  const [admin, moderator, regular] = await Promise.all([
    testPrisma.user.create({
      data: {
        email: "admin@test.com",
        name: "Admin User",
        serviceAccess: {
          chatService: "Admin",
          userService: "Admin",
          messageService: "Admin",
        },
      },
      select: { id: true, email: true },
    }),
    testPrisma.user.create({
      data: {
        email: "moderator@test.com",
        name: "Moderator User",
        serviceAccess: {
          chatService: "Moderate",
        },
      },
      select: { id: true, email: true },
    }),
    testPrisma.user.create({
      data: {
        email: "user@test.com",
        name: "Regular User",
      },
      select: { id: true, email: true },
    }),
  ]);

  return { admin, moderator, regular };
}
