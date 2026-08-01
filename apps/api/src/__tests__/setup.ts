// Integration test setup. Dual-mode database:
// - Real PostgreSQL (TEST_DATABASE_URL set, e.g. CI): each worker gets its own
//   database cloned from the migrated template by global-setup.
// - PGlite (no TEST_DATABASE_URL, local default): boot an in-memory PGlite
//   from the cached template dump — no PostgreSQL required.
import { PrismaClient } from "@project/db";
import { resetDatabase, setTestPrisma } from "@project/db/testing";
import { workerDatabaseUrl } from "@fitzzero/quickdraw-core/server/testing/prisma";
import { afterAll, beforeAll, beforeEach } from "vitest";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
// core's createRequireAuth has no dev fallback secret — set one so REST auth
// tests can sign and verify with the same key (CI's real value wins via ??=)
process.env.JWT_SECRET ??= "test-jwt-secret";

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
  // PGlite mode: load from the cached template dump built by global-setup.
  const { PGlite } = await import("@electric-sql/pglite");
  const { PrismaPGlite } = await import("pglite-prisma-adapter");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  const TEMPLATE_PATH = resolve(
    process.cwd(),
    "node_modules/.cache/quickdraw-chat-test-template.tar.gz",
  );

  let pglite: InstanceType<typeof PGlite>;

  beforeAll(async () => {
    const templateData = readFileSync(TEMPLATE_PATH);
    const blob = new Blob([templateData], { type: "application/x-gzip" });
    pglite = new PGlite({ loadDataDir: blob });
    await pglite.waitReady;

    const adapter = new PrismaPGlite(pglite);
    const client = new PrismaClient({ adapter, log: [] });
    setTestPrisma(client);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });
}
