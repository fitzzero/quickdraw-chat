// Integration test setup. Dual-mode database:
// - Real PostgreSQL (TEST_DATABASE_URL set, e.g. CI): each worker gets its own
//   database cloned from the migrated template by global-setup.
// - PGlite (no TEST_DATABASE_URL, local default): boot an in-memory PGlite
//   from the cached template dump — no PostgreSQL required.
import { PrismaClient } from "@project/db";
import { resetDatabase, setTestPrisma } from "@project/db/testing";
import { openPgliteFromTemplate, workerDatabaseUrl } from "@fitzzero/quickdraw-core/testing/prisma";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { TEST_TEMPLATE } from "./utils/test-template.js";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
// The auth tests sign with their own 32-character secret (utils/auth.ts);
// this covers anything else that reads the environment.
process.env.JWT_SECRET ??= "test-jwt-secret-of-at-least-32-characters";

// Set default service access for tests (matches production behavior)
// userService:Read allows any authenticated user to view profiles
process.env.SERVICE_DEFAULT_ACCESS = "userService:Read";

if (process.env.TEST_DATABASE_URL) {
  // Real PostgreSQL mode: rewrite TEST_DATABASE_URL to the worker-specific
  // database so the lazy testPrisma in @project/db/testing picks it up.
  const poolId = process.env.VITEST_POOL_ID ?? "0";
  process.env.TEST_DATABASE_URL = workerDatabaseUrl(process.env.TEST_DATABASE_URL, poolId);

  beforeEach(async () => {
    await resetDatabase();
  });
} else {
  // PGlite mode: this worker's own database, from the template global-setup
  // built (read through Node's Blob, so under the web's jsdom too)
  const { PrismaPGlite } = await import("pglite-prisma-adapter");

  let pglite: Awaited<ReturnType<typeof openPgliteFromTemplate>>;

  beforeAll(async () => {
    pglite = await openPgliteFromTemplate(TEST_TEMPLATE);
    setTestPrisma(new PrismaClient({ adapter: new PrismaPGlite(pglite), log: [] }));
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });
}
