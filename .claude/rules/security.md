# Security

What the template protects out of the box, and what a fork must do before
going to production.

## Protected out of the box

- **HTTP**: helmet on the API; CORS allowlist (`CLIENT_URL` +
  `EXTRA_ALLOWED_ORIGINS`, localhost dev-only); explicit 100kb JSON body
  limit; `trust proxy` scoped to production.
- **Auth**: httpOnly/secure/SameSite session cookie whose maxAge matches the
  7-day JWT and Session row (`SESSION_MAX_AGE_MS` in `auth/oauth-callback.ts`);
  OAuth CSRF state cookies compared timing-safe; tokens never in redirect
  URLs; DB-backed sessions with revocation (`/auth/logout`, `/auth/sessions`)
  plus an hourly expired-session sweep; OAuth provider tokens AES-256-GCM
  encrypted at rest; avatar URLs restricted to https.
- **Dev auth** (`ENABLE_MOCK_OAUTH`, `ENABLE_DEV_CREDENTIALS`) is triple-gated
  off in production — keep all three layers intact (see dev-auth.md).
- **Sockets**: global rate limiter (100/min/socket), per-channel token
  buckets, zod validation on every method/channel, ACL enforcement pipeline.
- **Rate limits (HTTP)**: OAuth + guest routes 20/15min; logout routes
  60/15min.
- **Web**: security headers + Report-Only CSP in `apps/web/next.config.mjs`;
  enforced `frame-ancestors` allowing only self + Discord Activity contexts.
- **CI/CD**: TruffleHog secret scan (blocking) + `bun audit` (advisory) in
  CI; TruffleHog also gates deploys; Renovate with vulnerability alerts.

## Required in production (API refuses to boot without them)

`DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`, `ENCRYPTION_KEY`.

## Fork checklist

- Generate fresh secrets: `JWT_SECRET` and `ENCRYPTION_KEY`
  (`openssl rand -hex 32` each) — never reuse another deploy's values.
- Set `ADMIN_EMAILS`; review `EXTRA_ALLOWED_ORIGINS` and `COOKIE_DOMAIN`.
- Never ship `ENABLE_MOCK_OAUTH` / `ENABLE_DEV_CREDENTIALS` to prod env.
- If you store user-pasted API keys: run `sanitizeToken()` then `encrypt()`
  (`apps/api/src/utils/`); compare shared secrets (webhooks, service tokens)
  with `timingSafeStringEqual()`, never `===`.
- Make the CI dependency audit blocking (remove `continue-on-error`) once
  you own the dependency tree.

## Tightening the CSP

The CSP ships Report-Only so nothing breaks silently. To enforce it: watch
the devtools console for `Content-Security-Policy-Report-Only` violations
across `/`, `/game`, and the Discord Activity; pin `img-src` to your actual
avatar CDNs; then merge the report-only directives into the enforced
`Content-Security-Policy` header (keep its `frame-ancestors` line). Forks
without the game/Discord Activity can drop `wasm-unsafe-eval`, the
`worker-src`/`media-src` blob entries, and the Discord `frame-ancestors`.

## Scaling caveat

All rate limiters (HTTP and socket) are in-memory per-instance: behind N
instances the effective limit is N×. Move to a shared store (core ships a
redis adapter — `setupRedisAdapter`) before scaling out; the game sim also
requires a single instance (see game-patterns.md).
