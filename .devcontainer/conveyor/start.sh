#!/usr/bin/env bash
set -euo pipefail

# postStartCommand — runs on every container start (after resume too).

# Ensure PostgreSQL is reachable (shared logic with the claudespace pod boot).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$ROOT/scripts/ensure-dev-db.sh"

echo ">> Ready. Run 'bun run dev' to start the API (4000) and Web (3000)."
