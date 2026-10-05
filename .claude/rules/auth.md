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
  `/auth/{provider}/start` and `/callback`, `/auth/providers`, `/auth/me`,
  `/auth/logout` and `/auth/logout-all` (POST, rate limited by the kit). A
  sign-in returns to the web app's `/auth/callback`, or to
  `/auth/login?error=...`.
  <!-- ── quickdraw-game:start ── -->
  Plus `POST /auth/guest` (`guest.ts`): a real user marked `isGuest`, so
  signed-out visitors can play; it answers `{ userId, name, token }` (the
  token for clients without cookies; the web uses the cookie).
  <!-- ── quickdraw-game:end ── -->
- **Providers** (`providersFor`): `google.optional(...)` and
  `discord.optional(...)` from the environment (nothing without
  credentials; one of the pair alone refuses to boot), and `mock(...)` for
  development.
- **What is served**: the kit's `GET /auth/providers` answers
  `{ providers: [{ id, name, kind }] }`, the sign-ins the routes serve now,
  in `providersFor`'s order (the mock only while `isMockOAuthEnabled()`),
  public and never cached; `auth.routes.providers()` answers the same in
  process. The login page reads it.
- **Users** (`users.ts`): `onLogin` → `upsertOAuthUser` finds the user by
  provider account, or creates one; provider tokens are stored `encrypt`ed
  when `ENCRYPTION_KEY` is set; avatars go through `safeImageUrl`. Only an
  address the provider verified is ever stored as a user's email
  (`User.emailVerified` records it): a profile without one gets the
  placeholder `<providerAccountId>@<provider>.local`, which never links or
  matches `ADMIN_EMAILS`. A verified address links the user holding it (a
  seeded or pre-provisioned user, a second provider), except a user someone
  signed in to before without a provider verifying that address (any address
  was stored before 5.0): that sign-in is refused. A known account's later
  sign-in records an address its provider now verifies (the stored one, or
  in place of its placeholder).
- **Sessions** (`sessions.ts`): `prismaSessions(prisma)`, the kit's
  `SessionStore` over the `Session` table (untracked writes: sessions are
  not live data). An hourly sweep in `index.ts` deletes expired rows.
- **Sockets and HTTP calls**: `createServer`'s `auth.authenticate` is
  `socketAuth(...)` over the same session keys, the allowed origins and
  the development credentials (`dev-credentials.ts`).
- **Grants** (`grants.ts`): `createGrantsLoader` is `auth.loadServiceAccess`:
  the user's `User.serviceAccess` over `SERVICE_DEFAULT_ACCESS`, or Admin on
  every service for an `ADMIN_EMAILS` user whose address a provider verified
  (stored on their row the first time). An `ADMIN_EMAILS` address no
  provider verified gets the defaults only, without the grants on its row.
  `auth.serviceAccessSource` names that column, so a tracked write to it
  (the admin screens' grants editor) reaches the user's open sockets.
- **Settings** (`config.ts`): `jwtSecretFromEnv`, `apiUrl`, `clientUrl` and
  `allowedOriginsFromEnv` (CORS, sign-in returns and cookie-authenticated
  sockets share one list); `apiUrlProblem` (no `API_URL` for a web app off
  localhost refuses to boot, in every `NODE_ENV`) and `trustProxyFromEnv`
  (`TRUST_PROXY`, else 1 in production or for an `https:` `API_URL`).

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

The login page offers the sign-ins the API serves, never a `NEXT_PUBLIC_*`
flag (baked in at build time, it drifts from the server): it reads
`authProviders(AUTH_ROUTES)` (the kit's `GET /auth/providers`, under a plain
TanStack `useQuery`) and renders `SignInOptions`
(`apps/web/src/components/auth/`): a button per OAuth provider labelled with
its `name`, the demo-user picker for the mock, a retry when the request
fails, and a notice when nothing is served.

## Adding a provider

1. Add it in `providersFor`: the kit's `google`/`discord` builders, or an
   object implementing `OAuthSignInProvider` (`authorizeUrl`, `profile`, and
   a `name` for its button: without one the button shows its id).
2. Register `{API_URL}/auth/{id}/callback` with the provider; add its client
   id and secret to `env.example` and the deploy secrets.
3. The login page offers it once the API serves it (`GET /auth/providers`),
   as "Continue with <name>"; for a button in its colors, add its id to
   `ProviderButton` in `apps/web/src/components/auth/SignInOptions.tsx`.
