#!/usr/bin/env bash
# Claudespace pod boot — point Conveyor's pod Start Command (Conveyor →
# Settings → Compute) at this script:
#
#   bash scripts/claudespace-start.sh
#
# Context: the bake image (scripts/bake-setup.sh) provides bun and a warm
# install cache in the home directory, but pod boot re-clones the repo fresh
# and runs none of the devcontainer lifecycle hooks — so node_modules, the
# conveyor-* skill symlinks, the database, and the dev stack all start absent.
# This script is the missing post-clone half. Every step is idempotent and
# re-runnable; there is deliberately no sentinel file (a sentinel written
# during a bake-time run freezes into the image and skips setup forever).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ">> Claudespace boot for $(basename "$ROOT")"

# Pod hooks don't get a login shell; the bake installs bun under $HOME/.bun.
if ! command -v bun &>/dev/null; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    echo ">> Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi
fi
echo ">> bun $(bun --version)"

# Plain install on purpose (NOT --ignore-scripts): the postinstall hook runs
# `conveyor-skills link`, which re-materializes the .claude/skills/conveyor-*
# symlinks that pod boot leaves dangling. Fast (~8s) — the bake cache is warm.
echo ">> Installing dependencies..."
bun install --frozen-lockfile

echo ">> Ensuring database..."
bash "$ROOT/scripts/ensure-dev-db.sh"

echo ">> Prisma client + migrations + seed..."
bun run db:generate
(cd packages/db && ../../scripts/load-env.sh bunx prisma migrate deploy)
bun run db:seed

# Best-effort: materialize the code graph the agent working rules point at.
# Never fails the boot; ~10s, no LLM calls.
if command -v graphify &>/dev/null; then
  echo ">> Building code graph (best-effort)..."
  graphify update . --no-cluster || echo ">> WARN: graphify update failed (continuing)"
fi

# Dev stack: API :4000 + web :3000, backgrounded so the boot hook returns.
# Guarded so a re-run (or an already-running stack) never double-starts it.
# The pattern is anchored to THIS repo's node_modules — a bare "turbo dev"
# also matches other repos' dev stacks on a shared machine.
if pgrep -f "$ROOT/node_modules/.*turbo dev" >/dev/null 2>&1; then
  echo ">> Dev stack already running"
else
  echo ">> Starting dev stack (API 4000, web 3000) — log: /tmp/quickdraw-dev.log"
  nohup bun run dev >/tmp/quickdraw-dev.log 2>&1 &
fi

echo ">> Claudespace ready. API http://0.0.0.0:4000, web http://0.0.0.0:3000."
