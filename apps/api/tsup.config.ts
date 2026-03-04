import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/mcp-server.ts", "src/mcp-bootstrap.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});


