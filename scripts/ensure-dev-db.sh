#!/usr/bin/env bash
# Shared dev-database bootstrap — the single source of truth for "make sure a
# dev PostgreSQL is reachable, provisioned, and ready" across every container
# context this repo boots in:
#
#   - Claudespace pod boot (scripts/claudespace-start.sh)
#   - Codespace / devcontainer resume (.devcontainer/conveyor/start.sh)
#
# Mode is detected from env, never flags:
#
#   remote-DB — DATABASE_URL is injected and points at a non-localhost host
#               (e.g. Conveyor's declared postgres sidecar, which shares the
#               pod's network namespace under a service hostname). The server
#               arrives provisioned: wait for readiness, never install, never
#               start a service, never run the local role/db bootstrap.
#   local-DB  — no DATABASE_URL, or it points at localhost: ensure a local
#               server exists (apt fallback — pods ship only client tools),
#               start it, and create the dev role + databases whenever the
#               postgres superuser is reachable. Conveyor's postgres sidecar
#               lands here too: it shares the pod's localhost, so it needs the
#               role/db bootstrap even though we did not install it.
#
# Idempotent by step, deliberately WITHOUT a sentinel file: a sentinel written
# during any bake-time execution is frozen into the image and every later boot
# would skip setup entirely (lesson learned in x-tokage-siege).
#
# Callable or sourceable; when sourced, call `ensure_dev_db` yourself.

set -euo pipefail

ensure_dev_db() {
  local url="${DATABASE_URL:-postgresql://dev:dev@localhost:5432/quickdraw_chat}"
  local host port
  host="$(printf '%s' "$url" | sed -nE 's|^[a-z+]+://([^/@]*@)?([^:/?]+).*|\2|p')"
  port="$(printf '%s' "$url" | sed -nE 's|^[a-z+]+://[^/]*:([0-9]+).*|\1|p')"
  [ -n "$port" ] || port=5432

  if [ -n "$host" ] && [ "$host" != "localhost" ] && [ "$host" != "127.0.0.1" ]; then
    # remote-DB: the sidecar/managed server owns provisioning — just wait.
    echo ">> ensure-dev-db: remote database at $host:$port — waiting for readiness"
    for _ in $(seq 1 30); do
      pg_isready -h "$host" -p "$port" && return 0
      sleep 1
    done
    echo ">> ensure-dev-db: database at $host:$port never became ready" >&2
    return 1
  fi

  # local-DB: ensure a server exists and is running.
  if ! pg_isready -h localhost -p "$port" &>/dev/null; then
    if ! command -v pg_ctlcluster &>/dev/null; then
      echo ">> ensure-dev-db: installing PostgreSQL server (apt)…"
      sudo apt-get update -qq && sudo apt-get install -y -qq postgresql postgresql-contrib
    fi
    # No hardcoded cluster version — apt may install 16, 18, or newer.
    sudo service postgresql start \
      || sudo pg_ctlcluster "$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')" main start \
      || true
    for _ in $(seq 1 30); do
      pg_isready -h localhost -p "$port" && break
      sleep 1
    done
  fi

  # Role + database — only when the postgres superuser is reachable, either
  # through sudo (a cluster we installed on this machine) or over TCP (a
  # sidecar container sharing our localhost). An externally provisioned
  # localhost server whose superuser is neither — e.g. the docker-compose
  # postgres on a dev box, whose superuser is `dev` — already has both,
  # courtesy of scripts/postgres-init.sql.
  if sudo -n -u postgres psql -c '' &>/dev/null; then
    echo ">> ensure-dev-db: ensuring dev role + database…"
    sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='dev'" | grep -q 1 \
      || sudo -u postgres psql -c "CREATE ROLE dev LOGIN PASSWORD 'dev' SUPERUSER;"
    sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='quickdraw_chat'" | grep -q 1 \
      || sudo -u postgres createdb -O dev quickdraw_chat
  elif PGPASSWORD="${PGPASSWORD:-postgres}" psql -h localhost -p "$port" -U postgres -c '' &>/dev/null; then
    # Conveyor's postgres sidecar: the server listens on the pod's localhost
    # but runs in its own container, so there is no local `postgres` OS user
    # to sudo to. Its superuser answers over TCP instead (trust auth), which
    # is the only administrative path a pod has.
    local -x PGPASSWORD="${PGPASSWORD:-postgres}"
    local db
    echo ">> ensure-dev-db: ensuring dev role + databases (superuser over TCP)…"
    psql -h localhost -p "$port" -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='dev'" | grep -q 1 \
      || psql -h localhost -p "$port" -U postgres -c "CREATE ROLE dev LOGIN PASSWORD 'dev' SUPERUSER;"
    # Same three databases scripts/postgres-init.sql creates on a compose dev
    # box: the shadow database is required by `prisma migrate dev`, the test
    # database by TEST_DATABASE_URL integration runs.
    for db in quickdraw_chat quickdraw_chat_shadow quickdraw_chat_test; do
      psql -h localhost -p "$port" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || createdb -h localhost -p "$port" -U postgres -O dev "$db"
    done
  else
    echo ">> ensure-dev-db: local server not sudo-administered — assuming role/db provisioned"
  fi
}

# Run directly (the common case); a sourcing caller invokes ensure_dev_db itself.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  ensure_dev_db
fi
