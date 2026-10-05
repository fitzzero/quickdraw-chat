---
paths:
  - "apps/api/**/*"
---

# API Conventions

The framework's rules for services, access and tests are the linked
`quickdraw-services.md`, `quickdraw-access.md` and `quickdraw-testing.md`.
This is how the API app is put together.

## One server, three transports

`apps/api/src/index.ts` is the composition root: an Express app (helmet,
CORS from the auth's allowed origins, cookie-parser, a 100 kB JSON body,
`/health`), the auth routes, then
`qd.createServer({ app, services, db, auth, cors, http })`.

<!-- ── quickdraw-game:start ── -->

Before it, the game's world row and chat are made (`ensureGlobalWorld`);
after it, the game's runtime and loop start (`game-patterns.md`). The game
service brings its own room-leave hook, so no root passes one.

<!-- ── quickdraw-game:end ── -->

Every service in `services/index.ts` is served three ways from the same
dispatcher, access checks and tracked writes:

- **Socket.IO**, protocol 5: the web client.
  <!-- ── quickdraw-game:start ── -->
  The Godot client speaks it too.
  <!-- ── quickdraw-game:end ── -->
- **HTTP**: `POST /qd/{service}/{method}`, with the session cookie or a
  bearer token (`http.rateLimit: createCallLimiter()`, since the HTTP
  transport has no limit of its own).
- **MCP**: `apps/api/src/mcp-server.ts` serves every method as a tool over
  stdio (`createMcpRegistry` + `createMcpStdioServer`), acting as
  `MCP_USER_ID` with that user's grants (anonymous without it). The root
  `.mcp.json` runs it through `scripts/load-env.sh`; `bun run build` first,
  then `bun run mcp` in `apps/api` to run it by hand.
  <!-- ── quickdraw-game:start ── -->
  `gameService` is not served there: every game method acts on the live
  sim and its players' sockets, and the MCP process runs no sim.
  <!-- ── quickdraw-game:end ── -->

## Data goes through services, not REST

Never add a REST endpoint for data: add a method to a service. REST is only
for the auth routes (the kit's, plus the app's own sign-in routes), `/health`,
the service worker's `POST /api/push/resubscribe` (a service worker has no
socket) and inbound webhooks. An app REST route:

- authenticates with `requireSession(auth.keys)` from
  `@fitzzero/quickdraw-core/server/auth` (a live session from the cookie or a
  bearer token; it answers 401 itself and sets `req.userId`);
- validates its body with `validateRequest(schema, req.body, res)` from
  `apps/api/src/utils/validate-request.ts`;
- does the work by calling the service in process
  (`qd.caller({ userId }).pushService.subscribePush(body)`), so the
  method's validation, access check and tracked writes are the socket's;
- is rate limited with a limiter from `@fitzzero/quickdraw-core/server/express`
  (`createAuthLimiter()`, `createPublicApiLimiter()`, `createWebhookLimiter()`).

## Limits and errors

- The socket rate limit is `createServer`'s default: 600 events a minute per
  socket, subscriptions, channels and cancels not counted. A
  `[quickdraw:repeated-call]` warning means a client loop: fix the client,
  never raise the limit.
- Expected failures throw `QuickdrawError` with a code (`NOT_FOUND`,
  `CONFLICT`, `VALIDATION`, ...); anything else reaches the caller as
  `INTERNAL`.
- Log with `logger` or `createServiceLogger(name)` from
  `apps/api/src/utils/logger.ts`, never `console`.

## Utilities

`apps/api/src/utils/`: `safeImageUrl` (https avatars only),
`sanitizeToken` then `encrypt` (from `@fitzzero/quickdraw-core/server`) for
user-pasted secrets, `timingSafeStringEqual` for comparing shared secrets
(webhooks, service tokens), `slugify` and `generateUniqueSlug`, and a small
`TTLCache`.
