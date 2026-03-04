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
import {
  McpRegistry,
  createMcpStdioServer,
} from "@fitzzero/quickdraw-core/server";
import type { AccessLevel } from "@project/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const envFile = process.env.DOTENV_CONFIG_PATH
  ? path.resolve(process.env.DOTENV_CONFIG_PATH)
  : path.join(projectRoot, ".env.local");
config({ path: envFile });
config({ path: path.join(projectRoot, ".env") });

const { prisma } = await import("@project/db");
const { UserService } = await import("./services/user/index.js");
const { ChatService } = await import("./services/chat/index.js");
const { MessageService } = await import("./services/message/index.js");
const { DocumentService } = await import("./services/document/index.js");

const mcpRegistry = new McpRegistry({
  hydrateUserContext: async (userId: string) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { serviceAccess: true },
      });
      return {
        serviceAccess:
          (user?.serviceAccess as Record<string, AccessLevel>) ?? {},
      };
    } catch {
      return { serviceAccess: {} };
    }
  },
});

mcpRegistry.registerService("userService", new UserService(prisma));
mcpRegistry.registerService("chatService", new ChatService(prisma));
mcpRegistry.registerService("messageService", new MessageService(prisma));
mcpRegistry.registerService("documentService", new DocumentService(prisma));

createMcpStdioServer({
  name: "quickdraw-chat-mcp",
  version: "0.1.0",
  registry: mcpRegistry,
});
