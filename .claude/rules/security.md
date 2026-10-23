# Security

What the template protects out of the box, and what a fork must do before
going to production. Access control itself (forms, row policies, failing
closed) is the linked `quickdraw-access.md`.

## Protected out of the box

- **HTTP**: helmet on the API; one allowlist of web origins for CORS, the
  sign-in's `returnTo`, cookie-authenticated sockets, HTTP calls and REST
  routes (`requireSession`: the cookie from another site's page answers 403) (`CLIENT_URL` and `EXTRA_ALLOWED_ORIGINS`, plus localhost outside
  production, in `auth/config.ts`; no GitHub Codespace but one those name,
  since anyone can open one: `load-env.sh` makes a Codespace's own web app
  `CLIENT_URL`); an
  explicit 100 kB JSON body limit; `trust proxy` from `TRUST_PROXY`, else
  1 in production and behind an `https:` `API_URL`, else off (the rate
  limits count the address it gives; quickdraw's own examples default to
  0, and this template's production, Cloud Run, has one proxy in front);
  `/qd` replies say `Cache-Control: no-store` and `nosniff`, so no cache
  keeps one user's data.
- **Auth** (quickdraw's auth routes kit): an httpOnly, Secure, SameSite
  session cookie (`__Host-session` over HTTPS, and read first wherever a
  request carries it) holding a JWT that names a revocable `Session` row (7
  days); a signed OAuth state cookie (`__Host-qd_oauth` over HTTPS),
  compared timing-safe; no token in a redirect URL; sign-out revokes the
  row and ends its sockets (`/auth/logout`, `/auth/logout-all`), a socket
  ends when its session expires, and an hourly sweep deletes expired rows;
  `/auth/me`, `/auth/logout` and `/auth/logout-all` answer 403 to the
  cookie from a page outside the allowlist; provider tokens AES-256-GCM
  encrypted at rest (`ENCRYPTION_KEY`);
  avatars restricted to https; only an email a provider verified is stored,
  links accounts or matches `ADMIN_EMAILS` (`User.emailVerified`; an
  unverified one leaves a `<id>@<provider>.local` placeholder).
- **Development auth** (`ENABLE_MOCK_OAUTH`, `ENABLE_DEV_CREDENTIALS`) runs
  only under `NODE_ENV` `development` or `test`, at every layer: the API
  refuses to boot with either flag under any other `NODE_ENV`, unset
  included; keep them all (see `dev-auth.md`).
- **Calls**: every method, channel and stream declares its access and fails
  closed; on a service with a row policy, `defineService` refuses a method
  whose input has `id` under a form that checks no row or another row,
  unless it says `rowless: true` (as `postMessage` does for the id a sender
  makes for the message it creates); every input and channel payload is checked
  against its contract's schema; the socket rate limit (600 events a minute
  per socket), each channel's token bucket and the HTTP transport's limit
  (`createCallLimiter()`, 300 calls a minute per IP); one socket holds at
  most 10,000 rows, 1,000 collection scopes and 1,000 topic watches (one
  more is `CONFLICT`).
  <!-- ── quickdraw-game:start ── -->
- **Party worlds** (host mode, `peers: true`): the server forwards peer
  links' signals and relays their messages only between signed-in sockets
  of one party's room, and `joinParty` admits any signed-in user who has
  the code (the code is the invitation). What a party's host and its
  players send each other never reaches the server, and the server trusts
  none of it: no party score is stored, and the host's word (who died, the
  leaderboard) stays inside the party. Each player's input is that
  player's word to the host, which steers only the snake of the user the
  server named for the link. A host plays on the server's word of who
  plays (`partyPlayer`), and closing a party is its host's alone (the row
  policy's `owner("hostUserId")`).
  <!-- ── quickdraw-game:end ── -->
- **Admin screens**: each contract's `admin.contract({ editable })` names the
  only fields the admin kit writes (a chat's title, a document's title and
  content, ...), so no owner, chat link or author is rewritten from them;
  any other field is `VALIDATION`, and the forms show it read-only.
  Messages and documents have no `adminCreate`. Only a person manages a
  user there (`kinds: ["user"]` on `userService`'s admin writes, grants
  included): an agent acting for an admin is refused. An address an admin
  types for a user is stored unverified: until a provider verifies it, it
  matches no `ADMIN_EMAILS` entry and links a sign-in only to a user
  nobody has signed in to yet. An `ADMIN_EMAILS` admin who edits their own
  address there (a change of case included) gets the default grants only
  from their next connection, until they sign in again with a provider
  that verifies it.
- **Rate limits on REST**: the kit's sign-in routes 60 per 15 minutes per
  IP, its session routes 120; the push resubscribe route
  `createAuthLimiter()`, 20 per 15 minutes.
  <!-- ── quickdraw-game:start ── -->
  The guest route counts as a sign-in route, and answers 403 to a page
  outside the allowlist; the Discord Activity sign-in takes
  `createAuthLimiter()` too.
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
  before they ship, and commit the access snapshot cells they add (read
  each one first).
- Give a new admin kit its `editable` list (`[]` when the screens only read
  and delete): without one it writes every field it shows, owner and
  foreign-key columns included.
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
