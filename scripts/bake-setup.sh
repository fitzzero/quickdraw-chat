#!/usr/bin/env bash
# Conveyor prebake setup command.
#
# Point the project's bake Setup Command (Conveyor → Settings → Compute) at
# this script rather than pasting shell into the settings field, so what the
# image bakes is versioned, reviewable, and changes with the repo.
#
# Context: Conveyor generates the bake Dockerfile. It bases on
# `mcr.microsoft.com/devcontainers/javascript-node:22`, npm-installs the agent
# toolchain, COPYs the repo in, and runs this script — so the two things this
# repo needs that the base image does NOT provide are:
#
#   1. bun. The image ships npm/yarn/pnpm, not bun. A bare `bun install` as
#      the Setup Command fails at bake time with "bun: command not found".
#   2. Node 24. The image is Node 22; .nvmrc pins 24 and CI honours it via
#      `actions/setup-node` with `node-version-file`. Best-effort here — the
#      bake still succeeds on 22 rather than failing the whole image.
#
# Deliberately NOT done here: migrations and seeding. Those need a live
# database, which does not exist at bake time (`claudespace.deps` is empty and
# a pod's localhost is the pod itself). `prisma generate` is safe — it reads
# schema.prisma and writes the client, it never connects.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ">> Prebake setup for $(basename "$ROOT")"

# 1. Node 24 (best-effort — the base image ships nvm at /usr/local/share/nvm)
if [ -s "${NVM_DIR:-/usr/local/share/nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-/usr/local/share/nvm}/nvm.sh"
  if nvm install && nvm use; then
    echo ">> Node $(node --version) (from .nvmrc)"
  else
    echo ">> WARN: nvm could not install $(cat .nvmrc) — staying on $(node --version)"
  fi
else
  echo ">> WARN: nvm not found — staying on Node $(node --version), .nvmrc wants $(cat .nvmrc)"
fi

# 2. bun
if ! command -v bun &>/dev/null; then
  echo ">> Installing bun..."
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
echo ">> bun $(bun --version)"

# 3. Dependencies. --ignore-scripts mirrors CI; the Prisma client is generated
#    explicitly below rather than via a postinstall hook.
echo ">> Installing dependencies..."
bun install --frozen-lockfile --ignore-scripts

# 4. Prisma client — the expensive generate step, baked in so pods skip it.
echo ">> Generating Prisma client..."
bun run db:generate

echo ">> Prebake setup complete"
