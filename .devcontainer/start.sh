#!/usr/bin/env bash
set -euo pipefail

# postStartCommand — runs on every container start (after resume too).

# Ensure PostgreSQL is running
if ! pg_isready -h localhost -p 5432 &>/dev/null; then
  sudo service postgresql start || sudo pg_ctlcluster 16 main start || true
  for i in $(seq 1 30); do
    pg_isready -h localhost -p 5432 && break
    sleep 1
  done
fi

echo ">> Ready. Run 'bun run dev' to start the API (4000) and Web (3000)."
