# quickdraw-chat

Reference implementation and production-ready template for [@fitzzero/quickdraw-core](https://github.com/fitzzero/quickdraw). A real-time chat application demonstrating the full quickdraw stack — fork it, rename it, and go.

## Purpose

This project serves as:

1. **Test bed** for developing @fitzzero/quickdraw-core features
2. **Reference implementation** showing best practices for quickdraw-based apps
3. **Production-ready template** for starting new quickdraw projects (conveyor-ready out of the box)

## Features

- **Real-time chat**: Socket.io for live updates and subscriptions
- **Type-safe**: End-to-end TypeScript with shared types
- **Service-based**: BaseService pattern with auto-wired Socket.io methods
- **Dual ACL patterns**: Membership table (Chat) and JSON ACL (Document) examples
- **Auth out of the box**: Google + Discord OAuth, session cookies, and a dev-only **mock OAuth** flow — sign in as seeded demo users with zero credentials
- **Dual-mode testing**: integration tests run on in-memory PGlite locally (no PostgreSQL, seconds) and real PostgreSQL in CI
- **Hardened API**: helmet, origin-validated CORS, rate-limited auth routes, production hard-blocks for dev flags
- **Modern React**: TanStack Query for server state management, Material-UI
- **CI/CD**: migration drift check, cached lint/typecheck/build, sharded tests; parameterized Cloud Run + Vercel deploy workflow
- **Claude-ready**: CLAUDE.md + path-scoped rules in `.claude/rules/`

## Quick Start

```bash
# Start postgres (or point DATABASE_URL elsewhere via .env.local)
docker-compose up -d

# Install dependencies
bun install

# Generate Prisma client, apply migrations, seed demo users
bun run db:generate
bun run db:migrate
bun run db:seed

# Start development (env loads via scripts/load-env.sh — no .env setup needed)
bun run dev
```

Open http://localhost:3000 → **Continue as demo user** → pick a seeded account
(admin@demo.local / moderator@demo.local / user@demo.local). No OAuth
credentials required in development.

## Environment

Layered loading via `scripts/load-env.sh` (used by `bun run dev` and db scripts):

1. `.env.infra` — checked-in dev defaults (DB URL, ports, URLs, dev flags)
2. optional secrets layer — commented hook for your secret manager
3. `.env.local` — your secrets & overrides, gitignored

See `env.example` for the secrets that belong in `.env.local`
(`JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAILS`, real OAuth credentials).
Real env vars (e.g. CI) always take precedence.

## Project Structure

```
.
├── apps/
│   ├── api/              # Express + Socket.io server
│   │   └── src/
│   │       ├── services/     # Business logic (User, Chat, Message, Document)
│   │       ├── auth/         # OAuth (google/discord/mock), JWT, middleware
│   │       └── __tests__/    # Integration tests + factories
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/          # Next.js app router
│           ├── components/   # React components
│           ├── hooks/        # Typed wrappers for quickdraw-core hooks
│           └── providers/    # QuickdrawProvider, ThemeProvider
├── packages/
│   ├── db/               # Prisma schema, migrations, client, seed
│   └── shared/           # Shared types (ServiceMethodsMap), room helpers
├── .claude/              # Claude Code rules + hooks
├── .devcontainer/conveyor/ # Conveyor agent devcontainer (codespace-ready)
└── .github/workflows/    # ci.yml + parameterized deploy.yml
```

## Services

| Service         | Purpose                    | ACL Pattern                                 |
| --------------- | -------------------------- | ------------------------------------------- |
| UserService     | User profile management    | Self-access (override `checkAccess`)        |
| ChatService     | Chat rooms with membership | Membership table (`checkEntryACL` override) |
| MessageService  | Real-time messaging        | Inherits from parent chat                   |
| DocumentService | Document collaboration     | JSON ACL (default `checkEntryACL`)          |

## Development

> Always use `bun run <script>` (never bare `bun <script>` — that invokes
> bun's built-ins instead of the turbo-routed package scripts).

```bash
# Development
bun run dev           # Start all apps in dev mode

# Building
bun run build         # Build all packages
bun run typecheck     # tsgo type check all packages

# Linting and formatting
bun run lint          # oxlint across all packages (strict: correctness/suspicious/pedantic deny)
bun run lint:fix      # Fix lint issues
bun run format        # oxfmt auto-format
bun run format:check  # Check formatting
bun run check         # lint + typecheck

# Testing
bun run test          # All tests (unit + integration)
bun run test:unit     # Unit tests only (no database)
bun run test:int      # Integration tests (PGlite locally, PostgreSQL when TEST_DATABASE_URL is set)
bun run test:coverage # With coverage

# Database
bun run db:generate   # Generate Prisma client
bun run db:migrate    # Create + apply a migration (required for schema changes)
bun run db:seed       # Seed demo users/chat/document (idempotent)
```

### Tooling

| Tool   | Purpose                            |
| ------ | ---------------------------------- |
| Bun    | Package manager and script runner  |
| oxlint | Linting (replaces ESLint)          |
| oxfmt  | Formatting (replaces Prettier)     |
| tsgo   | Type checking (replaces tsc)       |
| Turbo  | Monorepo build orchestration       |
| Vitest | Testing (unit + integration lanes) |

### Adding a New Service

1. Create the service in `apps/api/src/services/<name>/index.ts`
2. Define types as a new module in `packages/shared/src/types/` and register
   it in `types/service-methods.ts`
3. Register in `apps/api/src/index.ts`
4. Write integration tests

See `.claude/rules/service-architecture.md` for detailed patterns.

## Authentication

- **Mock OAuth (dev only)**: `ENABLE_MOCK_OAUTH=true` (default in `.env.infra`)
  serves a real OAuth code flow from the API itself with a seeded-user picker.
  Hard-blocked in production (the API refuses to boot with the flag set).
- **Google / Discord OAuth**: configure credentials in `.env.local`; flows are
  built on core's providers with CSRF state cookies and a shared callback
  (`apps/api/src/auth/oauth-callback.ts`).
- **Sessions**: JWT + database session row (revocable) carried in an
  httpOnly session cookie — the sole client credential (sockets and REST);
  no token ever appears in URLs or localStorage.
- **Bootstrap admin**: list emails in `ADMIN_EMAILS` to auto-promote to Admin.
- **Token encryption**: set `ENCRYPTION_KEY` (64-char hex) to encrypt stored
  OAuth tokens at rest (AES-256-GCM via core).

## Testing

Integration tests are dual-mode (see `.claude/rules/testing-patterns.md`):

- **Local (default)**: in-memory PGlite from a fingerprint-cached template —
  no PostgreSQL, full suite in seconds.
- **CI / real PostgreSQL**: set `TEST_DATABASE_URL`; each vitest worker gets
  its own database cloned from a migrated template DB.

Use `seedTestUsers()` and the factories in `apps/api/src/__tests__/factories/`
for data; `startTestServer()` + `connectAsUser()` for socket flows.

## Using as Template

```bash
# 1. Clone (or use GitHub's "Use this template" / `tel project new`)
git clone <this-repo> my-new-project
cd my-new-project

# 2. One-shot initialize: renames databases, titles, deploy service name,
#    devcontainer, optional backend port and @scope — then deletes itself
./scripts/init-fork.sh my-new-project 4010
# options: ./scripts/init-fork.sh <app-name> [backend-port] [--scope @myorg]

# 3. Start developing
docker-compose up -d
bun run db:generate && bun run db:migrate && bun run db:seed
bun run dev
```

The script only rewrites app identity — framework references
(`@fitzzero/quickdraw-core`, `QuickdrawProvider`, …) are untouched. Register
the port in telariel's `projects.json` if you assigned one.

**What's already configured:** strict linting (with custom quickdraw rules),
unit/integration test lanes, CI with migration drift checks, a parameterized
deploy workflow (Cloud Run + Vercel), Dockerfiles, mock OAuth dev login,
Claude Code rules + hooks, and a conveyor-ready devcontainer
(`.devcontainer/conveyor/`) so the repo passes conveyor's project readiness
checks immediately.

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). The short version: fill in the
placeholders in `.github/workflows/deploy.yml` + `apps/api/env.cloudrun.yaml`,
create the GitHub/GCP secrets it lists, and run the Deploy workflow
(TruffleHog scan → prisma migrate → Cloud Run API → Vercel web).

## License

MIT
