#!/usr/bin/env node
/**
 * MCP Server Bootstrap
 *
 * Entry point for Claude Code / Cursor (the root `.mcp.json`). Sends console
 * output to stderr before importing the MCP server, so only the JSON-RPC
 * protocol reaches stdout.
 *
 * Usage: node dist/mcp-bootstrap.js
 */

import { bootstrapMcpServer } from "@fitzzero/quickdraw-core/server/mcp";

// A URL resolves against this bundle (a bare relative path would resolve
// against the working directory).
await bootstrapMcpServer(new URL("./mcp-server.js", import.meta.url));
