import { createPrismaTestGlobalSetup } from "@fitzzero/quickdraw-core/testing/prisma";
import { TEST_TEMPLATE } from "./test-template.js";

/**
 * Vitest globalSetup for integration tests. Dual-mode:
 * - TEST_DATABASE_URL set → real PostgreSQL: migrate a template database and
 *   clone one database per vitest worker from it.
 * - No TEST_DATABASE_URL → PGlite: build (or reuse) a fingerprint-cached
 *   gzip template with all migrations applied (TEST_TEMPLATE). No PostgreSQL
 *   needed.
 */
// workerCount 8 covers vitest's 1-based VITEST_POOL_ID up to 7 with headroom
// over the configured maxWorkers (cloning from the template is cheap).
export const setup = createPrismaTestGlobalSetup({
  ...TEST_TEMPLATE,
  templateDbName: "quickdraw_chat_test",
  workerCount: 8,
});
