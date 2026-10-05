<p align="center">
  <img src="apps/web/public/logo.png" width="140" alt="Quickdraw logo" />
</p>

<h1 align="center">Quickdraw</h1>

<p align="center">
  <strong>The realtime fullstack starter for <a href="https://github.com/fitzzero/quickdraw">@fitzzero/quickdraw-core</a></strong><br />
  Typed realtime services, access policies on every row, and a full auth suite — already wired together.
<!-- ── quickdraw-game:start ── -->
  Plus a multiplayer game foundation.
<!-- ── quickdraw-game:end ── -->
</p>

<p align="center">
  <a href="https://quickdraw.techtree.gg"><strong>▶ See it live → quickdraw.techtree.gg</strong></a>
</p>

<p align="center">
  <a href="https://github.com/fitzzero/quickdraw-chat/actions/workflows/ci.yml"><img src="https://github.com/fitzzero/quickdraw-chat/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@fitzzero/quickdraw-core"><img src="https://img.shields.io/npm/v/%40fitzzero%2Fquickdraw-core?label=quickdraw-core&color=7c4dff" alt="quickdraw-core version" /></a>
  <img src="https://img.shields.io/badge/license-MIT-7aa2f7" alt="MIT license" />
</p>

---

This repo is three things at once:

1. **A production-ready template** — fork it, run one script, and start on the interesting part of your app.
2. **The reference implementation** of quickdraw 5.0: contracts, services with declared access, tracked writes, **collections**, kits, the realtime kit, the auth routes kit and the typed client.
3. **A working demo** — a realtime chat app on one typed API. [See it live.](https://quickdraw.techtree.gg)
   <!-- ── quickdraw-game:start ── -->
   The demo also ships a multiplayer Godot snake game on that same API.
   [Play it.](https://quickdraw.techtree.gg/game)
   <!-- ── quickdraw-game:end ── -->

## Live lists in one declaration

A **collection** is "the rows of one scope", declared once in the contract.
Writes go through the tracked Prisma client, and the server derives what
each subscriber's list must change: live deltas, pagination, resuming after
a reconnect, and access, with no hand-sent events, no refetching and no
client merge code.

```typescript
// packages/shared/src/contracts/message.ts — a chat's history
collections: {
  byChat: {
    scope: "chatId",
    item: "withAuthor", // a projection: the message with its author's profile
    order: [["createdAt", "desc"], ["id", "desc"]],
    limit: 50,
  },
},

// apps/api/src/services/message/index.ts — who may open a scope: Read on the chat
collections: { byChat: { anchor: chatContract } },
```

```tsx
// apps/web/src/components/chat/ChatWindow.tsx — the whole client
const { items, hasMore, loadMore } = qd.messageService.byChat.useCollection(chatId);
```

The template shows both scope shapes end to end:

| Collection                | Scope                                                 | Shows off                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messageService` `byChat` | a chat id (a column of the row)                       | Deltas from every `postMessage` and delete; `loadMore` pages back through the history; the scope is opened by Read on the chat (`anchor`)                                                                                             |
| `chatService` `myChats`   | **a user id**, through the `ChatMember` table (`via`) | One chat fans out to every member's list; an invite or removal adds or removes it, and writes the chat's `memberCount` column, which keeps each list's count live; ordered by `Chat.lastMessageAt`, which every message keeps current |

## What you get

- **Typed realtime services** — a contract per service in `packages/shared` (Zod schemas, methods, collections, events), implemented once with `qd.defineService` and consumed through a typed client (`qd.chatService.createChat.useMutation()`) on TanStack Query. One server answers over Socket.IO, HTTP and MCP.
- **Live data from tracked writes** — handlers write through the tracked Prisma client, and quickdraw sends entity frames and collection deltas to whoever may see them: no emits, no invalidation by hand.
- **Access on every row** — each method declares who may call it (`"authenticated"`, `{ entry: "Moderate" }`, a service-wide grant, ...) and each service a row policy, shown in all three shapes: an owner column (`pushService`), a JSON access list (`documentService`) and a membership table (`chatService`), plus public profiles (`everyone("Read")`). The same policy decides calls, subscriptions, collections and lists, and fails closed.
- **Kits instead of boilerplate** — the read/write, sharing and admin kits implement documents entirely; every service gets a generic admin screen at `/admin` (grants included) for free.
<!-- ── quickdraw-game:start ── -->
- **A multiplayer game foundation** _(optional — carve it out in one command)_ — a Godot 4 client speaking quickdraw's protocol 5 in GDScript, a 20 Hz input channel gated on the world's room, a volatile snapshot stream, client-side prediction + reconciliation, snapshot interpolation, server-side NPCs, guest play, live leaderboards, and React overlays driving the same typed API as the game engine.
<!-- ── quickdraw-game:end ── -->
- **Auth, all of it** — quickdraw's auth routes kit over the app's `Session` table: Google and Discord OAuth, revocable sessions in an httpOnly cookie, a **mock OAuth** provider for zero-credential local dev, and development credentials for tools. Development sign-in refuses to run in production.
<!-- ── quickdraw-game:start ── -->
- **Game sign-in** — guest sessions for anonymous play, a Discord Activity embed, and development credentials for the Godot editor.
<!-- ── quickdraw-game:end ── -->
- **MCP server** — every service method served as an MCP tool over stdio (`.mcp.json` wired for Claude Code), with the same access checks as the web app.
- **Tests that pin behavior** — the integration suites run on in-memory PGlite locally (no PostgreSQL, seconds) and real PostgreSQL in CI, with an access matrix per service, live-delta tests over real sockets, component tests against the real server, and committed query budgets for the hot paths.
- **CI/CD included** — migration drift checks, lint/typecheck/build, sharded tests, the API reference checked against the contracts, and a parameterized deploy workflow (TruffleHog → migrate → Cloud Run → Vercel).
- **Guardrails for humans & agents** — oxlint on `@fitzzero/quickdraw-lint`'s template config (untracked writes, unbounded reads, raw sockets, removed APIs, ...), oxfmt, tsgo, turbo, bun; quickdraw's agent rules and skills linked into `.claude/` beside this app's own path-scoped rules.

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

## Using as Template

```bash
# 1. Clone (or use GitHub's "Use this template" / `tel project new`)
git clone https://github.com/fitzzero/quickdraw-chat my-new-project
cd my-new-project

# 2. One-shot initialize: renames databases, titles, deploy service name,
#    devcontainer, optional backend port and @scope — then deletes itself
./scripts/init-fork.sh my-new-project 4010
# options: ./scripts/init-fork.sh <app-name> [backend-port] [--scope @myorg] [--without-game]
# ── quickdraw-storybook:start ──
#          [--without-storybook]
# ── quickdraw-storybook:end ──

# 3. Start developing
docker-compose up -d
bun run db:generate && bun run db:migrate && bun run db:seed
bun run dev
```

The script only rewrites app identity — framework references
(`@fitzzero/quickdraw-core`, `QuickdrawProvider`, …) are untouched.

<!-- ── quickdraw-game:start ── -->

**Not building a game?** `--without-game` removes the entire game foundation
(Godot app, gameService, definitionService, Discord Activity, guest sign-in,
scores, the netcode bench) along marked seams, regenerates the API
reference, then verifies the carve-out builds, lints, typechecks and tests
clean.

<!-- ── quickdraw-game:end ── -->

<!-- ── quickdraw-storybook:start ── -->

**No component catalog?** `--without-storybook` removes Storybook (config,
stories, docs, the CI step) the same way.

<!-- ── quickdraw-storybook:end ── -->

### Set up without Conveyor compute

If this repo was generated by [Conveyor](https://conveyor.rallycryapp.com)'s
project wizard but you skipped compute setup (no agent to run the rename for
you), initialize it manually:

```bash
git clone <your-new-repo> && cd <your-new-repo>
./scripts/init-fork.sh <your-project-name>
git add -A && git commit -m 'chore: initialize from template' && git push
```

Then follow the Quick Start above. Your Conveyor board works against the repo
either way — the rename just fixes package/database/display names.

**What's already configured:** strict linting (quickdraw-lint's template
config plus a local custom-rule plugin), unit/integration test lanes, CI with
migration drift checks, a parameterized deploy workflow (Cloud Run + Vercel),
Dockerfiles, mock OAuth dev login, Claude Code rules + hooks, quickdraw's
agent rules and skills (`@fitzzero/quickdraw-skills`) and the shared
Conveyor workflow skills (`@rallycry/conveyor-skills`), both symlinked into
`.claude/` and refreshed on every install by the `prepare` script, and a
conveyor-ready devcontainer (`.devcontainer/conveyor/`) so the repo passes
conveyor's project readiness checks immediately.

**Connecting a fork to Conveyor:**
[docs/conveyor-setup.md](docs/conveyor-setup.md) is the end-to-end journey —
project creation, the two Compute commands, MCP hookup for a local Claude
session, prebake, and the branch contract.

**Faster agent boots (optional):** Conveyor can prebake the agent image via a
GitHub Actions workflow it generates and commits for you — no GCP account
needed, and it can run on your own self-hosted runner. Nothing to implement in
this repo: flip it on in Conveyor's project settings when you want it. See
[docs/conveyor-prebake.md](docs/conveyor-prebake.md) for what gets generated
vs configured, plus a minimal shape illustration of the workflow.

## Project Structure

```
.
├── apps/
│   ├── api/              # Express + the quickdraw server (Socket.IO, HTTP, MCP)
│   │   └── src/
│   │       ├── services/     # One directory per service (qd.defineService)
│   │       ├── auth/         # The auth routes kit's wiring: providers, sessions, grants
│   │       └── __tests__/    # Integration tests, factories, budgets
<!-- ── quickdraw-game:start ── -->
│   ├── game/             # Godot 4 project (exports into apps/web/public/game)
│   ├── bench-web/        # Browser viewer for netcode benchmark runs
<!-- ── quickdraw-game:end ── -->
│   └── web/              # Next.js frontend (MUI, dark-tokyo theme)
<!-- ── quickdraw-storybook:start ── -->
│       ├── .storybook/   # Component catalog config (bun run storybook, port 6106)
<!-- ── quickdraw-storybook:end ── -->
│       └── src/
│           ├── app/          # App router pages
│           ├── components/   # React components, grouped by feature
│           ├── hooks/        # UI hooks (server data comes from the typed client)
│           ├── lib/          # The typed client (`qd`), auth helpers
│           └── providers/    # QuickdrawProvider, ThemeProvider
├── packages/
│   ├── db/               # Prisma schema, migrations, tracked client, seed
<!-- ── quickdraw-game:start ── -->
│   ├── bench/            # Netcode benchmark scenarios + scoring
<!-- ── quickdraw-game:end ── -->
│   └── shared/           # Contracts (one per service) and named types
├── docs/                 # API reference (generated), deployment, PWA, Conveyor guides
├── .claude/              # Claude Code rules + hooks; quickdraw's rules and skills (linked)
├── .devcontainer/conveyor/ # Conveyor agent devcontainer (codespace-ready)
└── .github/workflows/    # ci.yml, parameterized deploy.yml, conveyor-prebake.yml
```

## Services

| Service           | Purpose                              | Row policy                                        | Collections                         |
| ----------------- | ------------------------------------ | ------------------------------------------------- | ----------------------------------- |
| `userService`     | Profiles, the signed-in user, grants | Owner of the row, plus `everyone("Read")`         | —                                   |
| `chatService`     | Chat rooms with membership           | Membership table (`members` over `ChatMember`)    | `myChats` (each member's list, via) |
| `messageService`  | Real-time messaging                  | Inherited from the chat, plus the author as owner | `byChat` (a chat's history)         |
| `documentService` | Documents shared with others         | JSON access list (`jsonAcl`) plus the owner       | —                                   |
| `pushService`     | Web Push subscriptions (PWA)         | Owner of the row                                  | —                                   |

Every service also has the admin kit's methods (the `/admin` screens). The
API reference, generated from the contracts and the services (who may call
each method, the row policies, the field levels), is
[docs/api](docs/api/README.md) (`bun run docs:generate`).

## MCP Server

`apps/api/src/mcp-server.ts` serves every service method as an MCP tool over
stdio (`createMcpRegistry` + `createMcpStdioServer`), through the same
dispatcher, validation and access checks as the web app, acting as
`MCP_USER_ID` with that user's grants. The root `.mcp.json` registers it for
Claude Code — build once (`bun run build`), and the server runs through
`scripts/load-env.sh` so it sees the same database as `bun run dev`. Run it
manually with `bun run mcp` from `apps/api`.

<!-- ── quickdraw-game:start ── -->

| Game service        | Purpose                                          | Access                                                        |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `gameService`       | Multiplayer sim, high scores, the input channel  | Public reads and spectating; commands need a signed-in player |
| `definitionService` | Data-driven game content (tunables, live-edited) | Public reads, admin kit writes                                |

## Game Foundation

The template ships a working multiplayer game: a Godot 4 client
(`apps/game/`, embedded at `/game`) playing a slither-style snake in one
global world, with real netcode (client-side prediction + reconciliation,
snapshot-buffer interpolation), server-side NPC snakes, a GDScript client of
quickdraw's protocol 5, guest sessions for anonymous play, a public
high-scores page (`/scores`), a DOM overlay HUD + game-server chat,
DB-driven tunables editable in the admin UI, and a Discord Activity entry at
`/discord`.

- Patterns: `.claude/rules/game-patterns.md` (methods, the channel, the
  stream and events; rooms and the ordering contract; sim purity) and
  `apps/game/README.md` (editor setup, dev auth, export, Discord).
- Game commands are ordinary quickdraw methods — a React button and the Godot
  client call them identically; only tick-rate traffic uses the realtime
  kit's channel and stream. The pre-game dialog is the showcase: React
  drives the world Godot renders, through the same typed API.
- `bun run check:godot` runs two headless Godot clients in one world,
  through an API restart.
- **Not building a game?** `./scripts/init-fork.sh <name> --without-game`
removes all of it (or run `node scripts/strip-game.mjs` standalone).
<!-- ── quickdraw-game:end ── -->

## Development

> Always use `bun run <script>` (never bare `bun <script>` — that invokes
> bun's built-ins instead of the turbo-routed package scripts).

```bash
# Development
bun run dev           # Start all apps in dev mode
bun run reset:dev     # Clean slate: ff-only update to origin/dev (RESET_BRANCH overrides), clear build caches, reinstall, rebuild, migrate + seed

# Building
bun run build         # Build all packages
bun run typecheck     # tsgo type check all packages

# ── quickdraw-storybook:start ──
# Component catalog (see docs/storybook.md)
bun run storybook        # Storybook on http://localhost:6106
bun run build-storybook  # Static build (also a CI gate)
# ── quickdraw-storybook:end ──

# Linting and formatting
bun run lint          # oxlint across all packages (quickdraw-lint's template config)
bun run lint:fix      # Fix lint issues
bun run format        # oxfmt auto-format
bun run format:check  # Check formatting
bun run check         # lint + typecheck

# Testing
bun run test          # All tests (unit + integration)
bun run test:unit     # Unit tests only (no database)
bun run test:int      # Integration tests (PGlite locally, PostgreSQL when TEST_DATABASE_URL is set)
bun run test:coverage # With coverage

# API reference
bun run docs:generate # Regenerate docs/api from the contracts and services (quickdraw-docs)
bun run docs:check    # Fail when docs/api is stale (CI)

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

Ask your agent to use the `quickdraw-new-service` skill (linked into
`.claude/skills/`), or follow its five steps by hand:

1. The contract in `packages/shared/src/contracts/<name>.ts`, added to the
   `contracts` map in `contracts/index.ts`.
2. The service in `apps/api/src/services/<name>/index.ts`
   (`qd.defineService(contract, { model, access, methods })`), added to the
   list in `apps/api/src/services/index.ts`.
3. A Prisma model and migration if it has rows (`bun run db:migrate`, then
   `bun run db:generate`: Prisma 7's `migrate dev` leaves the client as it was).
4. The web app's hooks: `qd.<name>.<member>` is typed already.
5. Its tests: an access matrix, a live-behavior test, budgets for hot
   methods; then `bun run docs:generate`.

See `.claude/rules/service-architecture.md` for this app's conventions.

## Environment

Layered loading via `scripts/load-env.sh` (used by `bun run dev` and db scripts):

1. `.env.infra` — checked-in dev defaults (DB URL, ports, URLs, dev flags)
2. optional secrets layer — commented hook for your secret manager
3. `.env.local` — your secrets & overrides, gitignored

See `env.example` for the secrets that belong in `.env.local`
(`JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAILS`, real OAuth credentials).
Real env vars (e.g. CI) always take precedence.

## Authentication

- **The auth routes kit**: `/auth/{provider}/start` and `/callback`,
  `/auth/me`, `/auth/logout` and `/auth/logout-all`, over the app's `Session`
  table (`apps/api/src/auth/`). A session is a JWT naming a revocable
  session row, carried in an httpOnly cookie (`__Host-session` over HTTPS) —
  the one credential for sockets, HTTP calls and REST routes; no token ever
  appears in a URL or in localStorage.
- **Mock OAuth (dev only)**: `ENABLE_MOCK_OAUTH=true` (default in `.env.infra`)
  serves a real OAuth code flow from the API itself with a seeded-user picker.
  Refused in production (the API will not boot with the flag set).
- **Google / Discord OAuth**: set the client id and secret in `.env.local`;
a provider without credentials is left out, and one with only its id or only
its secret refuses to boot.
<!-- ── quickdraw-game:start ── -->
- **Guest sessions**: `POST /auth/guest` creates a real (marked `isGuest`)
  user and session so signed-out visitors can play the game.
- **Dev credentials**: `ENABLE_DEV_CREDENTIALS=true` lets the Godot editor
(and test bots) sign a socket in as a seeded user during development —
also refused in production.
<!-- ── quickdraw-game:end ── -->
- **Bootstrap admin**: list emails in `ADMIN_EMAILS` to auto-promote to Admin,
  once a sign-in provider verified the address (an unverified address is
  never stored: the user gets a `<id>@<provider>.local` placeholder).
- **Token encryption**: set `ENCRYPTION_KEY` (64-char hex) to encrypt stored
  OAuth tokens at rest (AES-256-GCM via core).

## Testing

Integration tests are dual-mode (see `.claude/rules/testing-patterns.md`):

- **Local (default)**: in-memory PGlite from a fingerprint-cached template —
  no PostgreSQL, full suite in seconds.
- **CI / real PostgreSQL**: set `TEST_DATABASE_URL`; each vitest worker gets
  its own database cloned from a migrated template DB.

`startTestApp()` (`apps/api/src/__tests__/utils/app.ts`) boots every service
on quickdraw's test server; call as a user with `app.as({ userId })` or over
a real socket with `app.connect({ userId })`. Each service pins who may call
each method with `describeAccessMatrix`, and the hot paths keep committed
budgets (`expectBudget`, `__budgets__/`). The web app's integration test
renders real pages against the same server (`renderWithQuickdraw`).

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). The short version: fill in the
placeholders in `.github/workflows/deploy.yml` + `apps/api/env.cloudrun.yaml`
(`CLIENT_URL`, `API_URL` and `ADMIN_EMAILS` there are the template's own),
create the GitHub/GCP secrets it lists, and run the Deploy workflow
(TruffleHog scan → prisma migrate → Cloud Run API → Vercel web). Prefer
self-hosting? The Dockerfiles + `docker-compose.yml` cover that path too.

## License

MIT
