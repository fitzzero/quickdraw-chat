# Connecting a fork to Conveyor

This is the end-to-end journey: a cloned fork on one side, Conveyor agents
opening pull requests on the other. Each step names the exact file, command or
setting.

[docs/conveyor-prebake.md](conveyor-prebake.md) is the deep dive on image
baking. This guide links to it rather than repeating it.

## 1. Create the project and connect the repo

1. Create a project in [Conveyor](https://conveyor.rallycryapp.com).
2. Connect your GitHub repository to it. Conveyor matches work to the repo by
   owner and name, so connect the fork, not the template.
3. If the fork still carries the template's names, run the rename first:

   ```bash
   ./scripts/init-fork.sh <your-project-name>
   git add -A && git commit -m 'chore: initialize from template' && git push
   ```

   Add `--without-game` to strip the game foundation at the same time.

## 2. Choose where agents run

Conveyor runs agents on compute you choose in **Project settings → Compute**.
This repo ships support for two shapes:

| Shape                                   | What this repo provides                                    | Best for                                          |
| --------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| GitHub Codespaces + GitHub Actions bake | `.devcontainer/conveyor/` and a generated bake workflow    | No cloud account. Everything stays inside GitHub. |
| Kubernetes pods (claudespaces)          | `scripts/bake-setup.sh` and `scripts/claudespace-start.sh` | Your own cluster, whether hosted or a local K3s.  |

The two are not exclusive: the same Setup and Start commands feed both, and
the bake producer is a separate setting.

Pick the bake producer in the same panel. **GitHub Actions** needs nothing
beyond the repo; **GCP Cloud Build** needs a linked GCP project.
[docs/conveyor-prebake.md](conveyor-prebake.md) covers the tradeoff and the
self-hosted runner setup.

## 3. Set the two Compute commands

These are the canonical values for this repo. Transcribe them into **Project
settings → Compute**:

- **Setup Command**: `bash scripts/bake-setup.sh`
- **Start Command**: `bash scripts/claudespace-start.sh`

The split matters. Setup runs at image-bake time, where no database exists: it
installs bun, runs `bun install`, and generates the Prisma client. Start runs
at pod boot after the repo is re-cloned: it reinstalls, brings up the
database, migrates and seeds, then backgrounds `bun run dev`.

Pod boot re-clones the repo over the baked checkout and runs none of the
devcontainer lifecycle hooks, so anything outside the home directory has to be
rebuilt by the Start command. That is why both commands exist.

## 4. Skills: nothing to configure

`@rallycry/conveyor-skills` is a devDependency, and the root `prepare` script
(`husky && conveyor-skills link`) symlinks the 9 `conveyor-*` skills into
`.claude/skills/` on every install. Renovate keeps the package current.

The symlinks point into `node_modules`, so they do not survive a pod's
re-clone. `scripts/claudespace-start.sh` runs `bun install`, which re-links
them. Nothing for you to set up.

## 5. Connect the Conveyor MCP to a local Claude session

An agent Conveyor provisions gets its MCP tools automatically. A Claude
session on your own machine does not.

This repo's `.mcp.json` declares only the project's own `quickdraw-chat` MCP
server (the socket services exposed as tools). There is no `conveyor` entry,
because the connection carries your personal token.

**Preferred path.** In Conveyor, open your project, then **Settings → User
Settings** (`/projects/<project>/user-settings`). The **Connect Claude Code**
section generates the exact command for your account and project. Use that.

**Manual repair**, if the generated command is unavailable or a token expired:

```bash
claude mcp remove conveyor -s local 2>/dev/null;
claude mcp add conveyor -s local \
  -e CONVEYOR_API_URL=<api-url> \
  -e CONVEYOR_USER_TOKEN=<user-token> \
  -e CONVEYOR_PROJECT_ID=<project-id> \
  -- npx -y @rallycry/conveyor-mcp@latest
```

Run it from the repo folder; `-s local` scopes the server there. The `remove`
prefix makes token rotation idempotent. `CONVEYOR_API_URL` and
`CONVEYOR_USER_TOKEN` are required; `CONVEYOR_PROJECT_ID` sets the default
project. Then reload MCP servers and check
`mcp__conveyor__get_connection_context`.

Two failure modes look alike and are not:

- Authentication errors mean the token expired. Re-run the connect flow.
- "Insufficient permissions" is what a mistyped `projectId` produces. Check
  the ID character by character before asking about your role.

## 6. Prebake: two things the prebake doc does not cover

Read [docs/conveyor-prebake.md](conveyor-prebake.md) first. These two facts
matter to a fork and live nowhere else.

### Image paths carry the template's owner and name

Three checked-in files hardcode `ghcr.io/fitzzero/quickdraw-chat/conveyor/*`:

- `.github/workflows/conveyor-prebake.yml` (8 occurrences)
- `.devcontainer/conveyor/docker-compose.yml`
- `docs/examples/conveyor-prebake.yml`

The first two carry a "Generated by Conveyor — do not edit by hand" header and
say they are re-committed whenever bake configuration drifts. So a fork should
get its own paths written for it on the first bake, not fix them by hand.

What that header states is all this repo can show. If your first bake pushes
to the template's namespace instead of yours, that is a Conveyor-side problem
to raise, not something to patch locally — a hand edit is overwritten by the
next regeneration.

`docs/examples/conveyor-prebake.yml` is documentation, not a live workflow. It
is never regenerated and its paths stay as written.

### The bake secrets are optional and specific to this repo

`.github/workflows/conveyor-prebake.yml` passes four secrets into the build:
`NPM_CACHE_READER_KEY`, `TIPTAP_PRO_TOKEN`,
`FONTAWESOME_NPM_TOKEN` (falling back to `FONT_AWESOME_TOKEN`), and
`GRIMOIRE_BUMP_TOKEN` (falling back to `github.token`).

None of them are needed to bake this repo. They come from the workflow
template, not from this project's dependencies. If you set none of them, the
build receives empty strings and succeeds. Do not go looking for values.

### Which devcontainer flavor am I on?

Look at `.devcontainer/conveyor/`:

- **Prebaked (compose) flavor** — `docker-compose.yml` exists and pulls
  `ghcr.io/<owner>/<repo>/conveyor/agent:current`, and `devcontainer.json`
  names `dockerComposeFile`. Codespaces boot from the baked image. This repo
  is on this flavor today.
- **v1 (features) flavor** — no `docker-compose.yml`; the container installs
  its toolchain at boot.

Conveyor switches you from v1 to compose after a first successful bake. Until
then v1 keeps working, so enabling the bake is safe at any point.

**The whole `.devcontainer/conveyor/` directory is generated.** Local edits to
it survive only until the next regeneration. Anything you need permanently
belongs in a file Conveyor does not own.

## 7. The branch contract

- Agents work on branches named `conveyor/<card-slug>`.
- Pull requests target **`dev`**, the integration branch. CI runs on every
  push and pull request against it.
- **`main`** is the deploy branch. Merging into it deploys to production
  through `.github/workflows/deploy.yml`. Nothing deploys from `dev`.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the human-facing version.

## Related docs

- [docs/conveyor-prebake.md](conveyor-prebake.md) — image baking in depth
- [CONTRIBUTING.md](../CONTRIBUTING.md) — branch contract and pre-push gates
- [CLAUDE.md](../CLAUDE.md) — project context for Claude sessions
- [DEPLOYMENT.md](../DEPLOYMENT.md) — production deploys
