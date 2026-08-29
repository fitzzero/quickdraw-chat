---
paths:
  - "apps/api/src/auth/**/*"
---

# Auth

How identity works in production. Dev-only sign-in (mock OAuth, dev
credentials, env layering) lives in [dev-auth.md](dev-auth.md); the hardening
inventory lives in [security.md](security.md).

## The one credential

A session is a **JWT paired with a `Session` row**. The JWT proves the claim,
the row makes it revocable, and the same credential authenticates both REST
and every socket:

- `jwt.ts` — `createJWT` / `verifyJWT`. Payload is `JWTPayload`.
- `session-store.ts` — `deleteSessionByToken`, `deleteSessionsForUser`,
  `deleteExpiredSessions` (an hourly sweep runs the last one).
- `oauth-callback.ts` — `SESSION_EXPIRY_DAYS` = 7. The cookie `maxAge`, the
  JWT expiry and the `Session` row expiry are all derived from
  `SESSION_MAX_AGE_MS`. Change one and you change all three; never let them
  drift apart.

The token reaches the server two ways, and **the token wins when both are
present**: `handshake.auth.token` for sockets, and an httpOnly cookie for
browsers. A cookie-less client (a native app, a game client, a bench bot) is
therefore a first-class case, not a workaround.

## OAuth providers

Each provider is a thin router over shared machinery. `google.ts` is the
reference; mirror it for a new one:

1. `registerXRoutes(router)` mounts the start and callback routes.
2. `issueOAuthState(res, cookieName)` before the redirect,
   `validateOAuthState(req, res, cookieName)` on the way back. State cookies
   are compared timing-safe.
3. `completeOAuthLogin` / `createSessionForProfile` in `oauth-callback.ts`
   mints the user, the account, the JWT and the `Session` row.

**No token ever appears in a redirect URL.** The callback sets the httpOnly
cookie and redirects. A flow that must hand a token back to a caller returns
it in a response body instead.

Provider access and refresh tokens are AES-256-GCM encrypted at rest.

## Sockets

`createSocketAuth({ prisma, getServiceNames })` in `middleware.ts` returns the
two hooks core's `createQuickdrawServer` expects:

- `authenticate(socket, auth)` — dev auth first (it no-ops outside dev), then
  token auth.
- `loadServiceAccess(userId)` — reads `user.serviceAccess`, merges
  `SERVICE_DEFAULT_ACCESS`, and applies `ADMIN_EMAILS` bootstrap promotion.

Production (`src/index.ts`) runs those hooks inside its own middleware because
it needs its own Express app for the OAuth routes; the test server passes the
same hooks straight to `createQuickdrawServer`. **Change auth in the hooks,
never in either runner** — that is what keeps the test suite exercising the
real path.

Identity reaches the client as an `auth:info` event
(`{ userId, serviceAccess, principalType }`), emitted for anonymous sockets
too.

## REST

REST is only for OAuth flows, health checks and inbound webhooks — never for
data. Every REST surface authenticates through `createRestRequireAuth(db)` in
`rest-middleware.ts`, which is cookie-first with a Bearer fallback and sets
`req.userId`. Use that factory rather than calling core's `createRequireAuth`
again, so there is one session-lookup path to audit.

`routes.ts` owns session management: `DELETE /auth/logout` revokes the
current token, `DELETE /auth/sessions` revokes every session for the user.
Both are rate limited at 60 per 15 minutes; the OAuth and guest routes get the
tighter 20 per 15 minutes.

## Adding a provider — checklist

1. Copy `google.ts`; register in `routes.ts`.
2. Reuse `issueOAuthState` / `validateOAuthState` and `completeOAuthLogin`.
3. Wrap the new routes with `createAuthLimiter()`.
4. Store provider tokens through `encrypt()`; never write them raw.
5. Add the client id and secret to `env.example` and the deploy secrets list.
