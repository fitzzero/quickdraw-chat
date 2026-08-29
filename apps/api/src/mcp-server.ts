/**
 * MCP Server for Cursor CLI Integration
 *
 * Standalone server implementing the Model Context Protocol (MCP).
 * Exposes all service methods as tools that Cursor can invoke.
 *
 * Protocol: JSON-RPC 2.0 over stdio
 */

import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { McpRegistry, createMcpStdioServer } from "@fitzzero/quickdraw-core/server";
import type { AccessLevel } from "@project/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const envFile = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : path.join(projectRoot, ".env.local");
config({ path: envFile });
config({ path: path.join(projectRoot, ".env") });

const { prisma } = await import("@project/db");
const { buildServices } = await import("./services/build-services.js");

const mcpRegistry = new McpRegistry({
  hydrateUserContext: async (userId: string) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { serviceAccess: true },
      });
      return {
        serviceAccess: (user?.serviceAccess as Record<string, AccessLevel>) ?? {},
      };
    } catch {
      return { serviceAccess: {} };
    }
  },
});

// gameService is deliberately NOT registered. McpRegistry.invoke() has no
// socket, but every game method binds to one: joinGame and respawn mutate
// live sim presence, watchWorld grants world-room membership by socket id,
// and there is no sim loop in this process. See .claude/rules/api-conventions.md.
const { gameService: _gameService, ...mcpServices } = buildServices(prisma);

for (const [name, service] of Object.entries(mcpServices)) {
  mcpRegistry.registerService(name, service);
}

createMcpStdioServer({
  name: "quickdraw-chat-mcp",
  version: "0.1.0",
  registry: mcpRegistry,
});
