# Conveyor tag glossary

The source of truth for this project's Conveyor tags.

A Conveyor tag is a glossary term. Each one carries a description, an
**overview** (the term's spec), and **context paths** (the rules, docs and
directories it wires into an agent's context). When a card is tagged, an agent
picking it up gets that context automatically.

Every overview here is **sourced from a repo file** via `overviewPath`, never
pasted into the tag. Editing the file updates the tag; the glossary cannot go
stale on its own. Write new prose only when no file covers the term.

Fork owners: recreate this tag set in your own Conveyor project from the table
below.

## The tag set

| Tag                    | Description                                                      | overviewPath                            | Parent |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------- | ------ |
| `service-architecture` | BaseService, methods, collections, ACL, write hooks.             | `.claude/rules/service-architecture.md` | —      |
| `api-conventions`      | What goes over sockets vs REST, and how the API is shaped.       | `.claude/rules/api-conventions.md`      | —      |
| `client-patterns`      | Typed React hooks, live lists, UI text and theming rules.        | `.claude/rules/client-patterns.md`      | —      |
| `database`             | Prisma schema, migrations, and the seed.                         | `.claude/rules/database-patterns.md`    | —      |
| `testing`              | The unit and integration lanes, and the dual-mode test database. | `.claude/rules/testing-patterns.md`     | —      |
| `auth`                 | Sessions, OAuth providers, socket and REST authentication.       | `.claude/rules/auth.md`                 | —      |
| `dev-auth`             | Mock OAuth, dev credentials, and env layering.                   | `.claude/rules/dev-auth.md`             | `auth` |
| `security`             | What the template protects, and the fork checklist.              | `.claude/rules/security.md`             | —      |
| `linting`              | oxlint config, the custom rule plugin, and formatting.           | `.claude/rules/linting.md`              | —      |
| `pwa-push`             | Installable web app and web push notifications.                  | `docs/pwa.md`                           | —      |
| `deployment`           | Cloud Run and Vercel deploys, plus CI.                           | `DEPLOYMENT.md`                         | —      |
| `conveyor-setup`       | Connecting a fork to Conveyor end to end.                        | `docs/conveyor-setup.md`                | —      |

<!-- ── quickdraw-game:start ── -->

### Game tags

The game foundation is optional, so its tags live in their own table.
`init-fork.sh --without-game` strips this section along with the files it
points at.

| Tag             | Description                                                   | overviewPath                     | Parent |
| --------------- | ------------------------------------------------------------- | -------------------------------- | ------ |
| `game`          | The game foundation: GameService, channels, the Godot client. | `.claude/rules/game-patterns.md` | —      |
| `netcode-bench` | The benchmark harness and the R&D hypothesis loop.            | `docs/netcode-bench.md`          | `game` |

| Tag             | Context paths                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `game`          | `apps/api/src/services/game` (folder), `apps/game` (folder), `.claude/rules/game-patterns.md` (rule)                |
| `netcode-bench` | `packages/bench` (folder), `apps/api/src/bench` (folder), `bench-baselines` (folder), `docs/netcode-bench.md` (doc) |

<!-- ── quickdraw-game:end ── -->

`external-pr` already exists and is unrelated to this set. Leave it alone.

## Context paths

| Tag                    | Context paths                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `service-architecture` | `apps/api/src/services` (folder), `apps/api/src/index.ts` (file), `.claude/rules/service-architecture.md` (rule)                         |
| `api-conventions`      | `apps/api/src` (folder), `apps/api/src/mcp-server.ts` (file), `.claude/rules/api-conventions.md` (rule)                                  |
| `client-patterns`      | `apps/web/src` (folder), `apps/web/src/hooks` (folder), `.claude/rules/client-patterns.md` (rule)                                        |
| `database`             | `packages/db` (folder), `packages/db/prisma/schema.prisma` (file), `.claude/rules/database-patterns.md` (rule)                           |
| `testing`              | `apps/api/src/__tests__` (folder), `apps/api/vitest.int.config.ts` (file), `.claude/rules/testing-patterns.md` (rule)                    |
| `auth`                 | `apps/api/src/auth` (folder), `.claude/rules/auth.md` (rule)                                                                             |
| `dev-auth`             | `apps/api/src/auth/mock.ts` (file), `scripts/load-env.sh` (file), `.claude/rules/dev-auth.md` (rule)                                     |
| `security`             | `apps/web/next.config.mjs` (file), `apps/api/src/auth/middleware.ts` (file), `.claude/rules/security.md` (rule)                          |
| `linting`              | `.oxlintrc.json` (file), `eslint-plugin-project` (folder), `.claude/rules/linting.md` (rule)                                             |
| `pwa-push`             | `apps/web/public/sw.js` (file), `apps/api/src/services/push-subscription` (folder), `docs/pwa.md` (doc)                                  |
| `deployment`           | `.github/workflows` (folder), `apps/api/Dockerfile` (file), `DEPLOYMENT.md` (doc)                                                        |
| `conveyor-setup`       | `.devcontainer/conveyor` (folder), `scripts/bake-setup.sh` (file), `scripts/claudespace-start.sh` (file), `docs/conveyor-setup.md` (doc) |

## Rules for maintaining it

1. **One source per term.** If a repo file already explains it, point
   `overviewPath` at that file. Do not paste prose into the tag.
2. **Names match the repo's own vocabulary.** A tag named for a thing the
   rules call something else is a term nobody will search for.
3. **Context paths are a full replacement on every update.** `update_tag`
   replaces the whole list, so include what you want to keep.
4. **Every path is checked against the repo.** A path that does not exist, or
whose type does not match what is on disk, rejects the whole call.
<!-- ── quickdraw-game:start ── -->
5. **Carving out the game** (`init-fork.sh --without-game`) strips the `game`
and `netcode-bench` rows from this file, because it deletes the files they
point at. Delete those two tags in the Conveyor project too.
<!-- ── quickdraw-game:end ── -->
