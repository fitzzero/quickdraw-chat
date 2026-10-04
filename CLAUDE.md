# Quickdraw Chat — Project Context

Quickdraw Chat is a real-time chat application template built on
`@fitzzero/quickdraw-core` 5.0 (typed real-time services: contracts,
`qd.defineService` with declared access and row policies, tracked Prisma
writes that keep live entities and collections current, kits, and a typed
React client). It is the worked example of a 5.0 app: live lists as
collections (a chat's messages, each user's chats through a membership
table), the three row-policy shapes (owner, JSON access list, membership
table), the read/write, sharing and admin kits, the auth routes kit (OAuth
plus a development mock sign-in), an MCP server, integration tests on
PGlite with access matrices and budgets, CI/CD, and conveyor-ready
devcontainer config. It is meant to be forked as the starting point for new
projects (`scripts/init-fork.sh`).

## Repository Structure

```
quickdraw-chat/
├── apps/
│   ├── api/          # Express + quickdraw server (Socket.IO, HTTP, MCP)
<!-- ── quickdraw-game:start ── -->
│   ├── game/         # Godot client for the demo snake world
│   ├── bench-web/    # Browser viewer for netcode benchmark runs
<!-- ── quickdraw-game:end ── -->
│   └── web/          # Next.js frontend (MUI) on the typed client
├── packages/
│   ├── db/           # Prisma schema, migrations, tracked client (@project/db)
<!-- ── quickdraw-game:start ── -->
│   ├── bench/        # Netcode benchmark scenarios + scoring (@project/bench)
<!-- ── quickdraw-game:end ── -->
│   └── shared/       # Contracts + named types (@project/shared)
├── docs/api/         # API reference, generated from the contracts
└── eslint-plugin-project/   # Repo-local lint rules
```

## Development Commands

> **Important:** Always use `bun run <script>`, never bare `bun <script>`.
> Bare commands like `bun test` and `bun build` invoke bun's built-in tools
> instead of the package.json scripts (which route through turbo).

```bash
# Run (from root)
bun run dev           # API (4000) + web (3000) dev servers, env via load-env.sh
bun run reset:dev     # Clean slate: ff-only to origin/dev (RESET_BRANCH overrides), clear caches, reinstall, rebuild, migrate + seed
bun run build         # Build all packages
bun run test          # All tests (unit + integration)
bun run test:unit     # Unit tests only (no database)
bun run test:int      # Integration tests (PGlite locally, PostgreSQL in CI)
bun run lint          # Lint all packages (oxlint on @fitzzero/quickdraw-lint's template config, see .claude/rules/linting.md)
bun run typecheck     # Type-check all packages (tsgo)
bun run check         # lint + typecheck
bun run docs:generate # Regenerate docs/api from the contracts (quickdraw-docs); docs:check verifies it

# ── quickdraw-storybook:start ──
bun run storybook     # Component catalog on http://localhost:6106 (see docs/storybook.md)
bun run build-storybook # Static Storybook build (also a CI gate)
# ── quickdraw-storybook:end ──

# Database (from root)
bun run db:generate   # Regenerate Prisma client after schema changes
bun run db:migrate    # Create + apply a migration (required for schema changes)
bun run db:seed       # Seed demo users (powers the mock OAuth login picker)
bun run db:studio     # Open Prisma Studio (from packages/db)

# Full quality check before committing
bun run check && bun run test

# ── quickdraw-game:start ──
# Netcode benchmarks (see docs/netcode-bench.md)
bun run bench:netcode                      # headless Tier-1 scorecard (default scenario)
bun run bench:netcode -- --all --runs 3    # full sweep, median-of-3
bun run bench:compare <baseline> <candidate>
bun run check:godot   # two headless Godot clients in one world, through an API restart
# ── quickdraw-game:end ──
```

First-time setup: `docker-compose up -d` (postgres) → `bun install` →
`bun run db:generate && bun run db:migrate && bun run db:seed` → `bun run dev`
→ sign in via "Continue as demo user".

Claudespace/Conveyor pods boot via `scripts/claudespace-start.sh` — see the
"Claudespace pods" section of `docs/conveyor-prebake.md`. To connect a fork to
Conveyor from scratch, see `docs/conveyor-setup.md`; the branch contract (PRs
target `dev`, `main` deploys) is in `CONTRIBUTING.md`.

## quickdraw 5.0 guidance

How to write against the framework ships in `@fitzzero/quickdraw-skills` and
is linked into `.claude/` by `quickdraw-skills link` (the `prepare` script;
CI checks the links): the rules `quickdraw-services.md`,
`quickdraw-access.md`, `quickdraw-client.md` and `quickdraw-testing.md`, and
the skills `quickdraw-new-service` (adding a service end to end) and
`quickdraw-migrate-v5`. They update with the package: never edit the links;
to change a rule for this app, replace its link with a copy. The framework's
README is `node_modules/@fitzzero/quickdraw-core/README.md` (installed in
each workspace package, e.g. `apps/api/node_modules/...`).

A spot where the framework fell short is marked
`// quickdraw-5.0 finding: ...` beside the smallest workaround; when a
quickdraw release fixes one, remove the workaround and its marker together.

## Domain-Specific Context

This app's own patterns are in `.claude/rules/`, scoped by path, so they load
when you work on matching files, beside the linked framework rules:

- `service-architecture.md`: contracts and services, the services as examples
- `api-conventions.md`: the server, its three transports, REST routes
- `auth.md` and `dev-auth.md`: sign-in, sessions, grants; development sign-in
- `database-patterns.md`: Prisma, migrations, tracked and untracked clients
- `client-patterns.md`: the web app on the typed client
- `testing-patterns.md`: the test app, access matrices, budgets
- `linting.md` and `security.md`
<!-- ── quickdraw-game:start ── -->
- `game-patterns.md`: the realtime game and its Godot client
  <!-- ── quickdraw-game:end ── -->
  <!-- ── quickdraw-storybook:start ── -->
- `storybook.md`: stories on the mock client
<!-- ── quickdraw-storybook:end ── -->
