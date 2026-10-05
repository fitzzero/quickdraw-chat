---
paths:
  - "apps/api/src/auth/**/*"
  - "apps/web/src/lib/auth.ts"
  - "apps/web/src/app/auth/**/*"
---

# Auth

How identity works in production, on quickdraw's auth routes kit
(`@fitzzero/quickdraw-core/server/auth`). Development sign-in (the mock
provider, development credentials, env layering) is in
[dev-auth.md](dev-auth.md); the hardening inventory in
[security.md](security.md).

## The pieces

`createAppAuth({ prisma, serviceNames, onRevoke })` in
`apps/api/src/auth/index.ts` builds everything, once per database, so every
server root (the API, the tests) signs in the same way:

- **Routes** (`createAuthRoutes`, one Express middleware): each provider's
  `/auth/{provider}/start` and `/callback`, `/auth/me`, `/auth/logout` and
  `/auth/logout-all` (POST, rate limited by the kit). A sign-in returns to
  the web app's `/auth/callback`, or to `/auth/login?error=...`.
  <!-- ── quickdraw-game:start ── -->
  Plus `POST /auth/guest` (`guest.ts`): a real user marked `isGuest`, so
  signed-out visitors can play; it answers `{ userId, name, token }` (the
  token for clients without cookies; the web uses the cookie).
  <!-- ── quickdraw-game:end ── -->
- **Providers** (`providersFor`): `google.optional(...)` and
  `discord.optional(...)` from the environment (nothing without
  credentials; one of the pair alone refuses to boot), and `mock(...)` for
  development.
- **Users** (`users.ts`): `onLogin` → `upsertOAuthUser` finds the user by
  provider account, links an existing user by email only when the provider
  verified it, or creates one (an unverified email becomes
  `<id>@<provider>.local`); provider tokens are stored `encrypt`ed when
  `ENCRYPTION_KEY` is set; avatars go through `safeImageUrl`.
- **Sessions** (`sessions.ts`): `prismaSessions(prisma)`, the kit's
  `SessionStore` over the `Session` table (untracked writes: sessions are
  not live data). An hourly sweep in `index.ts` deletes expired rows.
- **Sockets and HTTP calls**: `createServer`'s `auth.authenticate` is
  `socketAuth(...)` over the same session keys, the allowed origins and
  the development credentials (`dev-credentials.ts`).
- **Grants** (`grants.ts`): `createGrantsLoader` is `auth.loadServiceAccess`:
  the user's `User.serviceAccess` over `SERVICE_DEFAULT_ACCESS`, or Admin on
  every service for an `ADMIN_EMAILS` user (stored on their row the first
  time). `auth.serviceAccessSource` names that column, so a tracked write
  to it (the admin screens' grants editor) reaches the user's open sockets.
- **Settings** (`config.ts`): `jwtSecretFromEnv`, `apiUrl`, `clientUrl` and
  `allowedOriginsFromEnv` (CORS, sign-in returns and cookie-authenticated
  sockets share one list).

## The one credential

A session is a JWT naming a `Session` row (`sid`): the JWT proves the claim,
the row makes it revocable. The same credential authenticates every socket,
HTTP call and REST route, carried in an httpOnly cookie (`__Host-session`
over HTTPS, `session` over plain HTTP or when `COOKIE_DOMAIN` shares it with
subdomains) or as a token (`auth.token` in a handshake, a bearer header).
No token ever appears in a URL. Signing out revokes the row, and `onRevoke`
ends that session's sockets (`server.access.disconnectUser`).

<!-- ── quickdraw-game:start ── -->

The Discord Activity (`discord-activity.ts`) is the one sign-in outside the
kit's providers: its page POSTs the Embedded App SDK's code, and the route
starts a session with `issueSession` and answers its token (the iframe drops
third-party cookies).

<!-- ── quickdraw-game:end ── -->

## REST routes

An app route that needs a signed-in user takes `requireSession(auth.keys)`
(see `api-conventions.md`), never a hand-rolled JWT check: it reads the
cookie and the bearer token by the same rule as the sockets. The route reads
the session with `sessionOf(req)` and calls services as
`qd.caller(principal)`, which loads the user's grants (`auth.loadServiceAccess`)
as a socket's handshake does.

## The web side

The client's helpers speak the kit's routes: `signInUrl(provider,
AUTH_ROUTES)` is `/auth/{provider}/start?returnTo=<origin>`, and
`signOut(AUTH_ROUTES)` and `signOutEverywhere(AUTH_ROUTES)` POST
`/auth/logout` and `/auth/logout-all` with the cookie (`AUTH_ROUTES`, in
`apps/web/src/lib/auth.ts`, is where the API is). A sign-out rejects when the
API refuses or cannot be reached (the session may still be live: say so);
follow a successful one with a full page navigation so the socket reconnects
signed out.

## Adding a provider

1. Add it in `providersFor`: the kit's `google`/`discord` builders, or an
   object implementing `OAuthSignInProvider` (`authorizeUrl`, `profile`).
2. Register `{API_URL}/auth/{id}/callback` with the provider; add its client
   id and secret to `env.example` and the deploy secrets.
3. Add its button to the login page (`apps/web/src/app/auth/login/page.tsx`)
   with `signInUrl("<id>", AUTH_ROUTES)`.
