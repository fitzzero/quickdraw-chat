#!/usr/bin/env bash
set -euo pipefail

# onCreateCommand — runs during prebuild; the filesystem is cached afterwards.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Idempotency — skip if already completed (rm sentinel to force re-run)
SENTINEL="/tmp/.quickdraw-setup-complete"
if [ -f "$SENTINEL" ]; then
  echo ">> Setup already completed — skipping"
  exit 0
fi

echo "========================================"
echo "  Quickdraw Chat Codespace Setup"
echo "========================================"

# Fallback installs in case the devcontainer features were unavailable
if ! command -v bun &>/dev/null; then
  echo ">> Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
if ! command -v pg_isready &>/dev/null; then
  echo ">> Installing PostgreSQL..."
  sudo apt-get update -qq && sudo apt-get install -y -qq postgresql postgresql-contrib
fi

echo ">> Installing dependencies..."
bun install --frozen-lockfile

echo ">> Starting PostgreSQL..."
sudo service postgresql start || sudo pg_ctlcluster 16 main start || true
for i in $(seq 1 30); do
  pg_isready -h localhost -p 5432 && break
  sleep 1
done

echo ">> Creating dev role + database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='dev'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE dev LOGIN PASSWORD 'dev' SUPERUSER;"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='quickdraw_chat'" | grep -q 1 \
  || sudo -u postgres createdb -O dev quickdraw_chat

echo ">> Generating Prisma client + migrating + seeding..."
bun run db:generate
(cd packages/db && ../../scripts/load-env.sh bunx prisma migrate deploy)
bun run db:seed

touch "$SENTINEL"
echo ">> Setup complete"
