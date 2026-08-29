#!/usr/bin/env bash
set -euo pipefail

# Unified env loader. Wraps any command with layered env loading:
#   1. Infra config (checked-in, environment-aware): .env.infra
#   2. Secrets layer (optional): plug in your secret manager here
#   3. Local overrides (gitignored): .env.local
#
# Pre-existing env vars (e.g. CI) always take precedence over file layers.
#
# Usage:
#   scripts/load-env.sh <command> [args...]
#   scripts/load-env.sh turbo dev
#   ../../scripts/load-env.sh prisma migrate dev

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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
  [ -z "${GOOGLE_REDIRECT_URI+x}" ]  && export GOOGLE_REDIRECT_URI="${_api}/auth/google/callback"
  [ -z "${DISCORD_REDIRECT_URI+x}" ] && export DISCORD_REDIRECT_URI="${_api}/auth/discord/callback"

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

# 3. Local overrides (optional, gitignored)
[ -f "$ROOT/.env.local" ] && . "$ROOT/.env.local"
set +a
exec "$@"
