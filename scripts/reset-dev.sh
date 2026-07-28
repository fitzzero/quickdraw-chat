#!/usr/bin/env bash
# One-command clean slate (`bun run reset:dev`):
#   1. Return to `main` and fast-forward to origin/main.
#   2. Wipe the on-disk build caches (Next/Turbopack .next, .turbo,
#      node_modules/.cache) that balloon the web dev server's memory and
#      cause stale-build weirdness.
#   3. Reinstall, regenerate the Prisma client, force a fresh build, apply
#      pending migrations, and re-seed — after which `bun run dev` should
#      start with zero issues.
#
# This is NOT `bun run clean` — that only runs the per-package `clean` tasks
# and never touches `.next`. This clears exactly the caches that bloat while
# leaving node_modules intact (bun install reconciles it in step 3). The
# PGlite test templates need no step here: they are fingerprint-cached on
# migration contents and rebuild themselves.
#
# Refuses to discard work: if the tree is dirty or `main` has unpushed
# commits, it stops and tells you, rather than silently resetting.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- git: get onto a clean, up-to-date main --------------------------------
# next-env.d.ts is generated and churns between `next dev` and `next build`
# (.next/types vs .next/dev/types) — discard that noise before the dirty check.
git checkout --quiet -- apps/web/next-env.d.ts 2>/dev/null || true

if [ -n "$(git status --porcelain)" ]; then
  echo "reset:dev: working tree is dirty — commit, park on a branch, or discard first." >&2
  git status --short >&2
  exit 1
fi

echo "reset:dev: fetching origin/main…"
git fetch origin main

git checkout main

# Fast-forward only — never rewrites local commits. If main has diverged
# (e.g. unpushed work committed straight to main), this fails loudly.
if ! git merge --ff-only origin/main; then
  echo "reset:dev: local 'main' has diverged from origin/main — move those commits to a branch, then re-run." >&2
  exit 1
fi

# --- caches: clear the Next/Turbopack + turbo bloat ------------------------
for cache in apps/web/.next .turbo node_modules/.cache; do
  if [ -d "$cache" ]; then
    echo "reset:dev: removing $cache"
    rm -rf "$cache"
  fi
done

# --- reinstall, regenerate, rebuild ----------------------------------------
echo "reset:dev: installing dependencies…"
bun install

echo "reset:dev: regenerating Prisma client…"
bun run db:generate

echo "reset:dev: rebuilding all packages…"
bun run build --force

# --- database: apply pending migrations, re-seed ---------------------------
# Preflight: confirm postgres is actually reachable before prisma spends 10s
# timing out per command. Uses bun (always present) so it works cross-platform.
if ! scripts/load-env.sh bun -e '
  const net = require("node:net");
  const url = new URL(process.env.DATABASE_URL);
  const sock = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
  sock.on("connect", () => { sock.destroy(); process.exit(0); });
  sock.on("error", () => process.exit(1));
  setTimeout(() => process.exit(1), 3000);
'; then
  echo "reset:dev: database is not reachable (check DATABASE_URL) — start it, e.g. \`docker-compose up -d\`, then re-run." >&2
  exit 1
fi

# `migrate deploy` (not `db push`): this repo requires a migration file for
# every schema change (CI enforces it), so the local dev DB carries real
# migration history — deploy applies exactly the pending ones.
echo "reset:dev: applying pending migrations…"
bun run db:migrate:deploy

echo "reset:dev: seeding demo data…"
bun run db:seed

echo "reset:dev: done — on $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD), caches cleared, rebuilt, database synced."
