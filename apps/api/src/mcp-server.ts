/**
 * MCP Server for Claude Code / Cursor
 *
 * Serves the API's service methods to an agent as MCP tools over stdio
 * (JSON-RPC 2.0): one tool per method, generated from the contracts at start
 * (`{service}_{method}`, described by the method's `describe`, its input's
 * JSON Schema as the tool's arguments). Every call goes through this
 * process's own dispatcher with transport "mcp", so input validation, access
 * checks and limits apply exactly as on a socket. Writes go through the
 * tracked client; this process has no sockets, so the API server's
 * subscribers learn about them on their next read, not live.
 *
 * Who the session acts for: MCP_USER_ID (as in 4.x), with the user's grants;
 * without it the session is anonymous and may call "public" methods only.
 */

import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { createMcpRegistry, createMcpStdioServer } from "@fitzzero/quickdraw-core/server/mcp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const envFile = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : path.join(projectRoot, ".env.local");
config({ path: envFile });
config({ path: path.join(projectRoot, ".env") });

const { db, prisma } = await import("@project/db");
const { qd } = await import("./quickdraw.js");
const { serviceNames, services } = await import("./services/index.js");
const { createGrantsLoader } = await import("./auth/grants.js");

/** The services whose methods are not tools. */
const notServed = new Set<string>([
  // ── quickdraw-game:start ──
  // gameService: every game method binds to a live sim and its players'
  // sockets, and there is no sim loop in this process. See
  // .claude/rules/api-conventions.md.
  "gameService",
  // ── quickdraw-game:end ──
]);
const mcpServices = services.filter((service) => !notServed.has(service.name));

const dispatcher = qd.createDispatcher({ services, db });
const loadServiceAccess = createGrantsLoader({ prisma, serviceNames });

const registry = createMcpRegistry({
  services: mcpServices,
  dispatcher,
  principal: async () => {
    const userId = process.env.MCP_USER_ID;
    if (!userId) {
      return null;
    }
    return { userId, kind: "agent", serviceAccess: await loadServiceAccess(userId) };
  },
});

createMcpStdioServer({
  name: "quickdraw-chat-mcp",
  version: "0.1.0",
  registry,
});
