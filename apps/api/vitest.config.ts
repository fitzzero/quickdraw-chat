import { defineConfig } from "vitest/config";

// Unit tests only: *.test.ts excluding *.int.test.ts. No database — fast
// feedback for pure logic. Integration tests live in vitest.int.config.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.int.test.ts"],
    setupFiles: ["./src/__tests__/unit-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/*.test.ts", "**/testing.ts", "**/setup.ts"],
    },
  },
});
