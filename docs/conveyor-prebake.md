# Conveyor Prebake (GitHub Actions, no GCP)

> For the full fork-connection journey — project creation, Compute commands,
> MCP hookup, branch contract — see
> [conveyor-setup.md](conveyor-setup.md). This page covers image baking only.

Conveyor can "prebake" a project's agent image so codespaces boot with the
toolchain (conveyor-agent + Claude Code CLI) and your dependencies already
installed, instead of npm-installing them on every start. There are two bake
producers; this doc covers the one that needs **no cloud account at all**:

| Producer                  | Needs                   | Where it runs                                |
| ------------------------- | ----------------------- | -------------------------------------------- |
| GCP Cloud Build (default) | A linked GCP project    | Cloud Build                                  |
| **GitHub Actions**        | Nothing beyond the repo | GitHub-hosted or your own self-hosted runner |

Either way the result is the same: images land on GHCR at
`ghcr.io/<owner>/<repo>/conveyor/*:current` and Conveyor switches the generated
devcontainer (`.devcontainer/conveyor/`) to a compose flavor that boots from
them. This stacks with GitHub's own codespace _prebuild_ feature — a prebuild
snapshot of a prebaked devcontainer is the fastest boot.

## What Conveyor generates vs what you configure

**Conveyor generates** (do not hand-edit — regenerated and re-committed
whenever bake configuration drifts):

- `.github/workflows/conveyor-prebake.yml` — the bake workflow. A minimal
  shape illustration lives at [`docs/examples/conveyor-prebake.yml`](examples/conveyor-prebake.yml);
  the live workflow Conveyor commits is much larger and has your repo's
  owner/name baked in. The `run-name` carries a content hash Conveyor uses to
  match the run to its pending build record — renaming the workflow or the
  run-name breaks completion detection.
- `.devcontainer/conveyor/` — the devcontainer itself, in whichever flavor
  matches the bake state.

**You configure** (Conveyor project settings → Compute, with the provider set
to GitHub Codespaces):

- **Image Bake Runner** → `GitHub Actions`.
- **Actions Runner Label** (optional) — the workflow's `runs-on`. Empty means
  `ubuntu-latest` (GitHub-hosted). Set `self-hosted` to target your own
  runner.
- **Setup Command** — baked into the image (e.g. `bun install`). It runs
  during the Actions build _without_ any Conveyor-managed secrets; if it needs
  credentials, add them as repo Actions secrets and reference them yourself.

No registry credentials are needed: the workflow authenticates GHCR pushes
with its own `GITHUB_TOKEN` (`packages: write`).

## Self-hosted runner in ~5 minutes

Any Linux box with Docker works (the bake is just `docker build` + `docker
push`):

```bash
# Repo → Settings → Actions → Runners → New self-hosted runner, then:
mkdir ~/actions-runner-<repo> && cd ~/actions-runner-<repo>
curl -o actions-runner.tar.gz -L <download url from the runner page>
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/<owner>/<repo> --token <registration token>
sudo ./svc.sh install && sudo ./svc.sh start   # systemd service, survives reboots
```

The default labels (`self-hosted`, `Linux`, `X64`) are enough for a runner
label of `self-hosted`. The runner user must be able to run `docker` (member
of the `docker` group).

## Flow, end to end

1. You save the settings above; Conveyor commits the workflow + devcontainer.
2. When bake content drifts (setup command, deps, template changes), Conveyor
   dispatches the workflow with a content hash.
3. The run builds the agent image, pushes to GHCR, and mirrors any declared
   sidecar images (e.g. postgres).
4. Conveyor's webhook sees the run complete and records the images; the next
   devcontainer drift commit flips to the prebaked compose flavor.
5. New codespaces boot from the baked images — no install step.

Until a first bake lands, the v1 devcontainer keeps working as-is (it installs
the toolchain at boot), so enabling this is safe at any point.

## Claudespace pods (Kubernetes provider)

Pods boot differently from codespaces, and the difference is why a pod used to
spawn broken: pod boot **re-clones the repo fresh** over the baked checkout and
runs **none** of the devcontainer lifecycle hooks. Only home-directory
artifacts survive from the bake (`~/.bun` and bun's warm install cache) — so
`node_modules`, the `.claude/skills/conveyor-*` symlinks (they point into
`node_modules`), the database, and the dev stack all start absent.

The two Compute commands split the work:

- **Setup Command** → `bash scripts/bake-setup.sh` — runs at image-bake time
  (no database exists there): installs bun, `bun install`, Prisma generate.
- **Start Command** → `bash scripts/claudespace-start.sh` — runs at pod boot,
  after the clone: `bun install` (postinstall re-links the conveyor skills),
  database via `scripts/ensure-dev-db.sh`, migrate + seed, best-effort code
  graph, then backgrounds `bun run dev` (API :4000, web :3000).

`scripts/ensure-dev-db.sh` is shared with `.devcontainer/conveyor/start.sh`
and picks its mode from env: an injected `DATABASE_URL` with a non-localhost
host (the declared **PostgreSQL 16 sidecar** — the recommended setup) means
wait-for-ready only; otherwise it apt-installs and provisions a local server.
Every step is idempotent and there is no sentinel file — a sentinel written
during a bake run would freeze into the image and skip setup on every boot.

Pods set `CONVEYOR_CONTAINER_ROLE` (and bakes `CONVEYOR_POD_IMAGE_BUILD` /
`CONVEYOR_PREBAKED`); `scripts/load-env.sh` treats these as container contexts
so pods load `.env.infra.codespaces` and bind `0.0.0.0`.
