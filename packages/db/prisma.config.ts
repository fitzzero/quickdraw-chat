import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fallback for bare prisma invocations; scripts normally wrap with
// ../../scripts/load-env.sh and real env vars take precedence.
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.infra") });

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://dev:dev@localhost:5432/quickdraw_chat";

export default defineConfig({
  earlyAccess: true,
  schema: "./prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
    // Used by `prisma migrate diff --from-migrations` (CI drift check) and
    // `migrate dev`; defaults to a sibling _shadow database.
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ??
      databaseUrl.replace(/\/[^/?]+(\?|$)/, "/quickdraw_chat_shadow$1"),
  },
});
