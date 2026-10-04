import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Components against the real server (`*.int.test.tsx`): the API's services
// on quickdraw's test server (the API's `startTestApp`), each rendered with
// `renderWithQuickdraw` (the real provider, hooks and socket). The database
// set-up is the API's own (apps/api/src/__tests__): one PGlite database per
// worker, from a migrated template cached under this app's node_modules.
//
// Always PGlite: the API's suites own the PostgreSQL databases a
// TEST_DATABASE_URL names, and both would clone and drop the same template.
delete process.env.TEST_DATABASE_URL;

export default defineConfig({
  // oxlint-disable-next-line typescript/no-explicit-any -- Vite plugin types are incompatible with Vitest's defineConfig
  plugins: [react() as any],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.int.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    globalSetup: ["../api/src/__tests__/utils/global-setup.ts"],
    setupFiles: ["../api/src/__tests__/setup.ts", "./src/__tests__/dom-setup.ts"],
    pool: "forks",
    testTimeout: 20_000,
  },
});
