import { resolve } from "node:path";
import type { PgliteTemplateOptions } from "@fitzzero/quickdraw-core/testing/prisma";

/**
 * The migrated test database every PGlite worker boots from: global-setup.ts
 * builds it once per run (or reuses it while the migrations are unchanged),
 * and setup.ts opens one copy per worker (`openPgliteFromTemplate`). Paths
 * are the running package's: apps/api, or apps/web for its own tests, each
 * caching the dump under its node_modules.
 */
export const TEST_TEMPLATE: PgliteTemplateOptions = {
  migrationsDir: resolve(process.cwd(), "../../packages/db/prisma/migrations"),
  cacheDir: resolve(process.cwd(), "node_modules/.cache"),
  templateName: "quickdraw-chat-test-template",
};
