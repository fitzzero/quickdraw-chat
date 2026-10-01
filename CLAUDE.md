# Quickdraw Chat — Project Context

Quickdraw Chat is a real-time chat application template built on
`@fitzzero/quickdraw-core` 4.1 (framework for typed real-time Socket.IO
services). It is the reference demo for core's collection subscriptions —
live lists via `defineCollection`/`useCollection` (both scope shapes:
chat-scoped `byChat`, user-scoped fan-out `myChats`). It is meant to be
forked as the starting point for new projects: services with ACL patterns,
OAuth (+ a dev-only mock OAuth flow), an MCP server, dual-mode test
infrastructure, CI/CD, and conveyor-ready devcontainer config are all wired up.

## Repository Structure

```
quickdraw-chat/
├── apps/
│   ├── api/          # Express + Socket.IO backend
<!-- ── quickdraw-game:start ── -->
│   ├── game/         # Godot client for the demo snake world
│   ├── bench-web/    # Browser viewer for netcode benchmark runs
<!-- ── quickdraw-game:end ── -->
│   └── web/          # Next.js frontend (MUI)
├── packages/
│   ├── db/           # Prisma schema + client (@project/db)
<!-- ── quickdraw-game:start ── -->
│   ├── bench/        # Netcode benchmark scenarios + scoring (@project/bench)
<!-- ── quickdraw-game:end ── -->
│   └── shared/       # Shared TypeScript types (@project/shared)
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
bun run lint          # Lint all packages (oxlint, strict; extends quickdraw-core's shipped base config, see .claude/rules/linting.md)
bun run typecheck     # Type-check all packages (tsgo)
bun run check         # lint + typecheck

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
# ── quickdraw-game:end ──
```

First-time setup: `docker-compose up -d` (postgres) → `bun install` →
`bun run db:generate && bun run db:migrate && bun run db:seed` → `bun run dev`
→ sign in via "Continue as demo user".

Claudespace/Conveyor pods boot via `scripts/claudespace-start.sh` — see the
"Claudespace pods" section of `docs/conveyor-prebake.md`. To connect a fork to
Conveyor from scratch, see `docs/conveyor-setup.md`; the branch contract (PRs
target `dev`, `main` deploys) is in `CONTRIBUTING.md`.

## Domain-Specific Context

Detailed patterns for services, API conventions, database, testing, client,
and dev auth are in `.claude/rules/` with path-targeted scoping — they load
automatically when you work on matching files.
