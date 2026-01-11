import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    testing: "src/testing.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Bundle the generated Prisma client since it's TypeScript-only in Prisma 7
  noExternal: [/prisma\/generated/],
  external: ["@prisma/adapter-pg"],
});
