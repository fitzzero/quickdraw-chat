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

bootstrapMcpServer("./mcp-server.js");
