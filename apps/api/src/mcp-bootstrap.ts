#!/usr/bin/env node
/**
 * MCP Server Bootstrap
 *
 * Entry point for Cursor CLI. Redirects console to stderr
 * before importing the MCP server to protect the JSON-RPC protocol.
 *
 * Usage: node dist/mcp-bootstrap.js
 */

import { bootstrapMcpServer } from "@fitzzero/quickdraw-core/server";

// Absolute URL, not "./mcp-server.js": bootstrapMcpServer resolves the
// specifier from inside quickdraw-core's own dist, so a relative path looks
// for the file next to core rather than next to this bundle.
bootstrapMcpServer(new URL("./mcp-server.js", import.meta.url).href);
