import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // oxlint-disable-next-line typescript/no-explicit-any -- Vite plugin types are incompatible with Vitest's defineConfig
  plugins: [react() as any],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Components against the real server: vitest.int.config.ts
    exclude: ["**/node_modules/**", "**/.next/**", "src/**/*.int.test.ts", "src/**/*.int.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/testing.ts", "**/setup.ts"],
    },
  },
});
