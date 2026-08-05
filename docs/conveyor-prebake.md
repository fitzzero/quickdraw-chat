# Conveyor Prebake (GitHub Actions, no GCP)

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

**Conveyor generates** (regenerated and re-committed whenever bake
configuration drifts):

- `.github/workflows/conveyor-prebake.yml` — the bake workflow, committed to
  your **default branch the moment you save the settings** (no card or merge
  needed — GitHub only registers workflows from the default branch, so that is
  where it has to live). If the Conveyor GitHub App is missing the Workflows
  permission, you get an in-app alert naming the exact grant instead of a
  silent failure. A checked-in reference copy lives at
  [`docs/examples/conveyor-prebake.yml`](examples/conveyor-prebake.yml); the
  live one has your repo's owner/name baked in. The `run-name` carries a
  content hash Conveyor uses to match the run to its pending build record —
  renaming the workflow or the run-name breaks completion detection.
- `.devcontainer/conveyor/devcontainer.json` — the devcontainer, in whichever
  flavor matches the bake state. **Your own keys in this file survive
  regeneration**: `features`, extra `forwardPorts`/`portsAttributes`,
  `customizations`, `containerEnv`, and extra `onCreateCommand`/
  `postStartCommand` hooks are preserved through every re-commit (this
  template ships exactly that shape — its bun + postgres features, app ports,
  and the `.devcontainer/setup.sh` / `.devcontainer/start.sh` hooks all ride
  inside the generated file). Conveyor-owned keys (`name`, `image`, the
  generated portions of the lifecycle commands) are restamped each time.

**You configure** (Conveyor project settings → Compute, with the provider set
to GitHub Codespaces):

- **Machine Size** — the codespace VM. This is the sizing authority; do NOT
  add `hostRequirements` to the devcontainer (a repo-declared value only acts
  as a minimum floor and can conflict with the requested machine).
- **Sidecar Services** — e.g. PostgreSQL. On the prebaked lane these become
  compose services with their images mirrored to GHCR by the bake.
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

1. You save the settings above; Conveyor commits the workflow to your default
   branch right then (and refreshes the devcontainer on task branches at each
   kickoff).
2. When bake content drifts (setup command, deps, template changes), Conveyor
   dispatches the workflow with a content hash — and if the workflow is ever
   missing, the dispatch delivers it to the default branch and retries once
   on its own.
3. The run builds the agent image, pushes to GHCR, and mirrors any declared
   sidecar images (e.g. postgres).
4. Conveyor's webhook sees the run complete and records the images; the next
   devcontainer drift commit flips to the prebaked compose flavor.
5. New codespaces boot from the baked images — no install step.

Until a first bake lands, the v1 devcontainer keeps working as-is (it installs
the toolchain at boot), so enabling this is safe at any point.
