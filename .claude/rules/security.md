# Security

What the template protects out of the box, and what a fork must do before
going to production. Access control itself (forms, row policies, failing
closed) is the linked `quickdraw-access.md`.

## Protected out of the box

- **HTTP**: helmet on the API; one allowlist of web origins for CORS, the
  sign-in's `returnTo` and cookie-authenticated sockets (`CLIENT_URL` and
  `EXTRA_ALLOWED_ORIGINS`; GitHub Codespaces and localhost outside
  production only, in `auth/config.ts`: anyone can open a Codespace); an
  explicit 100 kB JSON body limit; `trust proxy` from `TRUST_PROXY`, else
  1 in production and behind an `https:` `API_URL`, else off (the rate
  limits count the address it gives).
- **Auth** (quickdraw's auth routes kit): an httpOnly, Secure, SameSite
  session cookie (`__Host-session` over HTTPS) holding a JWT that names a
  revocable `Session` row (7 days); OAuth state cookies compared timing-safe;
  no token in a redirect URL; sign-out revokes the row and ends its sockets
  (`/auth/logout`, `/auth/logout-all`), and an hourly sweep deletes expired
  rows; provider tokens AES-256-GCM encrypted at rest (`ENCRYPTION_KEY`);
  avatars restricted to https; only an email a provider verified is stored,
  links accounts or matches `ADMIN_EMAILS` (`User.emailVerified`; an
  unverified one leaves a `<id>@<provider>.local` placeholder).
- **Development auth** (`ENABLE_MOCK_OAUTH`, `ENABLE_DEV_CREDENTIALS`) is
  off in production at every layer; keep them all (see `dev-auth.md`).
- **Calls**: every method, channel and stream declares its access and fails
  closed; every input and channel payload is checked against its contract's
  schema; the socket rate limit (600 events a minute per socket), each
  channel's token bucket and the HTTP transport's limit
  (`createCallLimiter()`, 300 calls a minute per IP).
- **Rate limits on REST**: the kit's sign-in routes 60 per 15 minutes per
  IP, its session routes 120; the push resubscribe route
  `createAuthLimiter()`, 20 per 15 minutes.
  <!-- ── quickdraw-game:start ── -->
  The guest route counts as a sign-in route; the Discord Activity sign-in
  takes `createAuthLimiter()` too.
  <!-- ── quickdraw-game:end ── -->
- **Web**: security headers and a Report-Only CSP in
  `apps/web/next.config.mjs`, with an enforced `frame-ancestors`.
  <!-- ── quickdraw-game:start ── -->
  It allows self plus the Discord Activity contexts, nothing else.
  <!-- ── quickdraw-game:end ── -->
- **CI/CD**: a TruffleHog secret scan (blocking) and `bun audit` (advisory)
  in CI; TruffleHog also gates deploys; Renovate with vulnerability alerts.

## Required in production (the API refuses to boot without them)

`DATABASE_URL`, `JWT_SECRET` (32 characters or more), `CLIENT_URL`,
`API_URL`, `ENCRYPTION_KEY` (64 hex characters; a set key of any other shape
refuses to boot in every environment).

In every environment the API also refuses to boot without `API_URL` while
`CLIENT_URL` or an `EXTRA_ALLOWED_ORIGINS` entry is off localhost (sign-ins
would be sent to `http://localhost:<port>`), and with a `TRUST_PROXY` that
is not a number of hops, `true` or `false`.

## Fork checklist

- Generate fresh secrets: `JWT_SECRET` and `ENCRYPTION_KEY`
  (`openssl rand -hex 32` each); never reuse another deploy's values.
- Set `ADMIN_EMAILS`; review `EXTRA_ALLOWED_ORIGINS` and `COOKIE_DOMAIN`.
- Never ship `ENABLE_MOCK_OAUTH` or `ENABLE_DEV_CREDENTIALS` to production.
- If you store user-pasted API keys: `sanitizeToken()` then `encrypt()`
  (`apps/api/src/utils/`); compare shared secrets (webhooks, service tokens)
  with `timingSafeStringEqual()`, never `===`.
- Give a new service's methods an access matrix (`describeAccessMatrix`)
  before they ship.
- Make the CI dependency audit blocking (remove `continue-on-error`) once
  you own the dependency tree.

## Tightening the CSP

The CSP ships Report-Only so nothing breaks silently. To enforce it: watch
the devtools console for `Content-Security-Policy-Report-Only` violations
across every route; pin `img-src` to your actual avatar CDNs; then merge the
report-only directives into the enforced `Content-Security-Policy` header
(keep its `frame-ancestors` line).

<!-- ── quickdraw-game:start ── -->

The game routes (`/game`, the Discord Activity) are the ones most likely to
report violations. `./scripts/init-fork.sh --without-game` already drops
`wasm-unsafe-eval`, the `worker-src`/`media-src` blob entries, the `img-src`
`blob:` token and the Discord `frame-ancestors`: those directives live in
marker-wrapped arrays in `apps/web/next.config.mjs`.

<!-- ── quickdraw-game:end ── -->

## Scaling caveat

The rate limiters (HTTP and socket) count per process: behind N instances
the effective limit is N times as high. Several nodes run behind one Valkey
(`setupRedisAdapter`, quickdraw's `docs/deploying.md`); give the HTTP
limiters a shared store before scaling out.

<!-- ── quickdraw-game:start ── -->

The game sim also requires a single instance (see game-patterns.md).

<!-- ── quickdraw-game:end ── -->
