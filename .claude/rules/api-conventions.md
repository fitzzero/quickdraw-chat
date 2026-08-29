---
paths:
  - "apps/api/**/*"
---

# API Conventions

- **All data operations** use Socket.IO via `BaseService.defineMethod()` — never add REST endpoints for data
- **Live row lists** are collections (`defineCollection` + client `useCollection`), not list methods — see service-architecture.md; declare every method in the shared method map and end `initMethods` with `verifyAllMethods([...])` (that's the real helper name; `assertAllMethodsDefined` never existed)
- **REST only** for: OAuth flows (`apps/api/src/auth/`), health checks, inbound webhooks
- REST routers are factory functions (`createAuthRouter()` style); validate request payloads with `validateRequest()` from `apps/api/src/utils/validate-request.ts`
- Socket auth is shaped as core's `createQuickdrawServer` hooks: `createSocketAuth({ prisma, getServiceNames })` in `auth/middleware.ts` returns `{ authenticate, loadServiceAccess }`. Production (`src/index.ts`) runs them in a local middleware (it needs its own Express app for OAuth); the test server passes the same hooks straight to `createQuickdrawServer` — change auth in the hooks, never in the runners
- Auth is cookie-based: OAuth completion sets the httpOnly session cookie and redirects without any token in the URL; the socket handshake carries the cookie (`withCredentials`), identity arrives via `auth:info` (`{ userId, serviceAccess, principalType }`, emitted for anonymous sockets too); REST endpoints use `requireAuth` from `apps/api/src/auth/rest-middleware.ts` (cookie-first, Bearer fallback)
- Rate limiting: OAuth routes are wrapped with `createAuthLimiter()`; new public REST surfaces get `createPublicApiLimiter()` / `createWebhookLimiter()` from `@fitzzero/quickdraw-core/server/express`. The socket limiter's `excludeEvents` is exact-match — subscription exemptions are built per registered service in `src/index.ts` (subscribe/batchSubscribe/unsubscribe/collection:subscribe/collection:unsubscribe)
- New OAuth providers: mirror `auth/google.ts` — core provider + `issueOAuthState`/`validateOAuthState` + `completeOAuthLogin` from `auth/oauth-callback.ts`
- MCP: `apps/api/src/mcp-server.ts` exposes every service method as an MCP tool over stdio (core's `McpRegistry`). Root `.mcp.json` wires it for Claude Code; run `bun run build` first, then `bun run mcp` from `apps/api` to run it manually
<!-- ── quickdraw-game:start ── -->
- MCP has one deliberate exception: `gameService` is not registered, because `McpRegistry.invoke()` carries no socket and every game method binds to one (live sim presence, `ctx.socketId` room grants) in a process that runs no sim loop
<!-- ── quickdraw-game:end ── -->
