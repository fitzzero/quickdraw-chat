import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { trackPrisma } from "@fitzzero/quickdraw-core/prisma";
import { resetDatabase as coreResetDatabase } from "@fitzzero/quickdraw-core/testing/prisma";

let _testPrisma: PrismaClient | undefined;
let _testDb: PrismaClient | undefined;

/**
 * Inject a PrismaClient instance for the current worker.
 * Called by PGlite-based test setup to replace the default Postgres-backed client.
 */
export function setTestPrisma(client: PrismaClient): void {
  _testPrisma = client;
  _testDb = undefined;
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
/** The untracked test client: seed and inspect rows with it (nobody is told about its writes). */
export const testPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(getTestPrisma(), prop);
  },
});

/**
 * The tracked test client, made exactly as the server's `db` is
 * (`trackPrisma` over the worker's database): pass it to `createTestApp`, so
 * the services' writes reach the test server's flush and its subscribers.
 */
export const testDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    _testDb ??= trackPrisma(getTestPrisma());
    return Reflect.get(_testDb, prop);
  },
});

/**
 * Reset the test database by truncating all public tables (dynamic discovery,
 * deadlock retry — see quickdraw-core/testing/prisma).
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
