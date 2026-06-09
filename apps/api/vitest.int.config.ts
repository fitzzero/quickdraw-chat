import { defineConfig } from "vitest/config";

// Integration tests: *.int.test.ts against a real database (dual-mode —
// PostgreSQL per-worker clones when TEST_DATABASE_URL is set, PGlite
// otherwise; see src/__tests__/utils/global-setup.ts).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: ["./src/__tests__/utils/global-setup.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/*.test.ts", "**/testing.ts", "**/setup.ts"],
    },
    // Forks + limited parallelism: each worker owns a database (real-PG mode)
    // or an in-memory PGlite instance, files within a worker run sequentially.
    pool: "forks",
    maxWorkers: 4,
    fileParallelism: true,
  },
});
