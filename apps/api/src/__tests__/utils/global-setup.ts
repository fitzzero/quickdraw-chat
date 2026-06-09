import { resolve } from "node:path";
import { createPrismaTestGlobalSetup } from "@fitzzero/quickdraw-core/server/testing/prisma";

/**
 * Vitest globalSetup for integration tests. Dual-mode:
 * - TEST_DATABASE_URL set → real PostgreSQL: migrate a template database and
 *   clone one database per vitest worker from it.
 * - No TEST_DATABASE_URL → PGlite: build (or reuse) a fingerprint-cached
 *   gzip template with all migrations applied. No PostgreSQL needed.
 */
// workerCount 8 covers vitest's 1-based VITEST_POOL_ID up to 7 with headroom
// over the configured maxWorkers (cloning from the template is cheap).
export const setup = createPrismaTestGlobalSetup({
  migrationsDir: resolve(process.cwd(), "../../packages/db/prisma/migrations"),
  templateDbName: "quickdraw_chat_test",
  templateName: "quickdraw-chat-test-template",
  workerCount: 8,
});
