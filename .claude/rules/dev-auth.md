---
paths:
  - "apps/api/src/auth/**/*"
  - "scripts/load-env.sh"
  - ".env.infra"
---

# Dev Auth & Environment

## Environment layering

`scripts/load-env.sh <command>` loads, lowest precedence first:

1. `.env.infra`: checked-in development defaults (database URL, ports,
   URLs, development flags)
2. an optional secrets layer (a commented hook for a secret manager)
3. `.env.local`: secrets and overrides, gitignored (see `env.example`)

Real environment variables (CI) always win. `bun run dev` and the database
scripts already run through the loader.

## Development sign-in (no OAuth credentials needed)

- **Mock OAuth** (`ENABLE_MOCK_OAUTH=true` and
  `NEXT_PUBLIC_ENABLE_MOCK_OAUTH=true`, on in `.env.infra`): "Continue as
  demo user" on the login page runs a real OAuth code flow against
  `/auth/mock/provider/*`, served by the API itself (the auth routes kit's
  `mock({ listUsers })` provider). The picker lists users from the database:
  run `bun run db:seed` first (admin@demo.local, moderator@demo.local,
  user@demo.local).
- **Development credentials** (`ENABLE_DEV_CREDENTIALS=true`): a socket may
  sign in by naming a user in its handshake (`auth: { userId }`, no token),
  through `socketAuth({ devCredentials })` and `auth/dev-credentials.ts`;
  an unknown user id is refused. The integration tests, load-test bots and
  the Godot editor use it.

Both are **hard-blocked in production**: the API refuses to boot with either
flag set when `NODE_ENV=production` (`index.ts`), `devCredentials` answers
nothing there, `socketAuth` refuses such a handshake in production, and the
kit never serves the mock provider's routes there. Keep every layer when
touching auth.

## Bootstrap access

- `ADMIN_EMAILS`: comma-separated emails that get Admin on every service at
  their next sign-in or handshake (`grants.ts`).
- `SERVICE_DEFAULT_ACCESS`: grants every signed-in user starts with, under
  their own (format `serviceName:Level,...`; `.env.infra` gives
  `userService:Read`).
