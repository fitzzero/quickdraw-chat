---
paths:
  - "apps/api/src/auth/**/*"
  - "scripts/load-env.sh"
  - ".env.infra"
---

# Dev Auth & Environment

## Environment layering

`scripts/load-env.sh <command>` loads, lowest precedence first:

1. `.env.infra` — checked-in dev defaults (DB URL, ports, URLs, dev flags)
2. optional secrets layer (commented hook for a secret manager)
3. `.env.local` — secrets & overrides, gitignored (see `env.example`)

Real env vars (CI) always win. `bun run dev` and the db scripts already wrap
themselves with the loader.

## Dev sign-in (no real OAuth credentials needed)

- **Mock OAuth** (`ENABLE_MOCK_OAUTH=true` + `NEXT_PUBLIC_ENABLE_MOCK_OAUTH=true`,
  on by default in `.env.infra`): "Continue as demo user" on the login page runs
  a real OAuth code flow against `/auth/mock/provider/*` served by the API
  itself (core's `registerMockOAuthProvider`). The picker lists users from the
  database — run `bun run db:seed` first (admin@demo.local / moderator@demo.local /
  user@demo.local).
- **Dev credentials** (`ENABLE_DEV_CREDENTIALS=true`): socket handshake accepts
  `auth.userId` directly — used by integration tests.

Both are **hard-blocked in production**: the API refuses to boot with either
flag set when `NODE_ENV=production`, dev auth refuses at request time, and
core never mounts the mock provider routes. Keep all three layers intact when
touching auth.

## Bootstrap access

- `ADMIN_EMAILS` — comma-separated emails auto-promoted to Admin on all
  services at sign-in
- `SERVICE_DEFAULT_ACCESS` — default access merged for every signed-in user
  (format `serviceName:Level,...`)
