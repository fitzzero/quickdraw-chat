#!/usr/bin/env bash
set -euo pipefail

# Unified env loader. Wraps any command with layered env loading:
#   1. Infra config (checked-in, environment-aware): .env.infra
#   2. Secrets layer (optional): plug in your secret manager here
#   3. Local overrides (gitignored): .env.local
#
# Pre-existing env vars (e.g. CI) always take precedence over file layers:
# `DATABASE_URL=... scripts/load-env.sh prisma migrate deploy` uses that
# DATABASE_URL whatever .env.local says (apps/api/src/__tests__/load-env.test.ts
# checks the order).
#
# Usage:
#   scripts/load-env.sh <command> [args...]
#   scripts/load-env.sh turbo dev
#   ../../scripts/load-env.sh prisma migrate dev

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The variables .env.local sets that the environment already has: their
# values now, restored after .env.local is sourced (step 3), so the real
# environment wins over it as it does over .env.infra
_keep=""
_name='^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)='
if [ -f "$ROOT/.env.local" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    if [[ $_line =~ $_name ]]; then
      _var="${BASH_REMATCH[2]}"
      if [ -n "${!_var+x}" ]; then
        _keep+="export $_var=$(printf '%q' "${!_var}");"
      fi
    fi
  done < "$ROOT/.env.local"
fi

# 1. Infra config (defaults — pre-existing env vars take precedence, e.g. CI)
# Container detection includes Conveyor contexts: CONVEYOR_CONTAINER_ROLE is set
# in claudespace pods (which have no /.dockerenv), CONVEYOR_PREBAKED /
# CONVEYOR_POD_IMAGE_BUILD cover bake-time runs where BuildKit hides it too.
_infra_file="$ROOT/.env.infra"
if [ "${CODESPACES:-}" = "true" ] || [ -n "${REMOTE_CONTAINERS:-}" ] || [ -f /.dockerenv ] \
  || [ -n "${CONVEYOR_CONTAINER_ROLE:-}" ] || [ -n "${CONVEYOR_PREBAKED:-}" ] \
  || [ -n "${CONVEYOR_POD_IMAGE_BUILD:-}" ]; then
  [ -f "$ROOT/.env.infra.codespaces" ] && _infra_file="$ROOT/.env.infra.codespaces"
fi
if [ -f "$_infra_file" ]; then
  while IFS= read -r _line; do
    [[ "$_line" =~ ^[[:space:]]*(#|$) ]] && continue
    _var="${_line%%=*}"
    [[ -z "${!_var+x}" ]] && export "$_line"
  done < "$_infra_file"
fi

# 1b. Dynamic codespace URLs (port-forwarded)
if [ "${CODESPACES:-}" = "true" ] && [ -n "${CODESPACE_NAME:-}" ]; then
  _domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  _api="https://${CODESPACE_NAME}-${BACKEND_PORT:-4000}.${_domain}"
  _web="https://${CODESPACE_NAME}-${FRONTEND_PORT:-3000}.${_domain}"
  [ -z "${CLIENT_URL+x}" ]           && export CLIENT_URL="$_web"
  [ -z "${API_URL+x}" ]              && export API_URL="$_api"
  [ -z "${NEXT_PUBLIC_API_URL+x}" ]  && export NEXT_PUBLIC_API_URL="$_api"

  # Ensure forwarded ports are publicly accessible (devcontainer.json visibility
  # isn't always honored). Runs in background to avoid blocking startup.
  if command -v gh &>/dev/null; then
    gh codespace ports visibility "${BACKEND_PORT:-4000}:public" "${FRONTEND_PORT:-3000}:public" -c "$CODESPACE_NAME" 2>/dev/null &
  fi
fi

set -a
# 2. (optional) Secrets layer — plug in your secret manager here, e.g.:
#    eval "$("$ROOT/scripts/secrets-pull.sh" --export)"
# Conveyor's GCP Secret Manager variant lives at scripts/secrets-pull.sh in
# the conveyor repo if you want a reference implementation.

# 3. Local overrides (optional, gitignored): over .env.infra, never over the
# environment the script was started with
[ -f "$ROOT/.env.local" ] && . "$ROOT/.env.local"
set +a
eval "$_keep"
exec "$@"
