#!/usr/bin/env bash
set -euo pipefail

# One-shot template initializer. Run once after forking/cloning quickdraw-chat:
#
#   ./scripts/init-fork.sh <app-name> [backend-port] [--scope @yourscope] [--without-game]
#   ./scripts/init-fork.sh acme-books 4010
#   ./scripts/init-fork.sh acme-books --without-game   # non-game fork
#
# Rewrites the app identity (database names, titles, deploy service name,
# devcontainer, MCP server name), optionally the backend port and the
# @project/* package scope, refreshes the lockfile, formats, then deletes
# itself. --without-game removes the entire game foundation first (Godot app,
# GameService, DefinitionService, Discord Activity — see scripts/strip-game.mjs).
# Framework references (quickdraw-core, QuickdrawProvider, ...) are untouched.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Portable in-place sed (GNU: -i, BSD/macOS: -i '')
if sed --version >/dev/null 2>&1; then
  SED_I=(sed -i)
else
  SED_I=(sed -i '')
fi

usage() {
  sed -n '4,12p' "$0"
  exit 1
}

NAME="${1:-}"
[ -z "$NAME" ] && usage
shift

PORT=""
SCOPE=""
WITHOUT_GAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scope)
      SCOPE="${2#@}"
      shift 2
      ;;
    --without-game)
      WITHOUT_GAME="1"
      shift
      ;;
    *)
      PORT="$1"
      shift
      ;;
  esac
done

if ! echo "$NAME" | grep -qE '^[a-z][a-z0-9-]*$'; then
  echo "error: app name must be kebab-case (got '$NAME')" >&2
  exit 1
fi
if [ -n "$PORT" ] && ! echo "$PORT" | grep -qE '^[0-9]{4,5}$'; then
  echo "error: backend port must be numeric (got '$PORT')" >&2
  exit 1
fi

DB_NAME="${NAME//-/_}"
# kebab-case -> Title Case ("acme-books" -> "Acme Books") — portable (no GNU \u)
DISPLAY="$(echo "$NAME" | awk -F- '{ for (i = 1; i <= NF; i++) $i = toupper(substr($i, 1, 1)) substr($i, 2) } 1' OFS=" ")"

echo "App name:     $NAME"
echo "Display name: $DISPLAY"
echo "Database:     $DB_NAME (+ ${DB_NAME}_test, ${DB_NAME}_shadow)"
[ -n "$PORT" ] && echo "Backend port: 4000 -> $PORT"
[ -n "$SCOPE" ] && echo "Pkg scope:    @project -> @$SCOPE"
[ -n "$WITHOUT_GAME" ] && echo "Game:         removing (Godot app, GameService, definitions, Discord Activity)"
echo ""

# ── 0. Optional: carve out the game foundation ───────────────────────
if [ -n "$WITHOUT_GAME" ]; then
  node scripts/strip-game.mjs
fi

# Tracked text files only — never touch node_modules/.git or binaries
# (BSD sed chokes on non-UTF8 bytes). Migration SQL is name-free; the
# lockfile only carries the workspace name (identity pass).
FILES=$(git ls-files | grep -vE '^packages/db/prisma/migrations/|\.(wasm|pck|png|ico|jpg|jpeg|gif|webp|woff2?)$')
# After --without-game, ls-files still lists the deleted paths — drop them
if [ -n "$WITHOUT_GAME" ]; then
  FILES=$(echo "$FILES" | while read -r f; do [ -f "$f" ] && echo "$f"; done)
fi

# ── 1. App identity ──────────────────────────────────────────────────
echo "$FILES" | xargs "${SED_I[@]}" \
  -e "s/quickdraw_chat/${DB_NAME}/g" \
  -e "s/quickdraw-chat/${NAME}/g" \
  -e "s/Quickdraw Chat/${DISPLAY}/g"

# ── 1b. Display brand ─────────────────────────────────────────────────
# The web app brands itself "Quickdraw" front-facing (landing, metadata,
# manifest, README). Rename it in the files that carry display strings.
# Framework identifiers (QuickdrawProvider, QuickdrawHost, quickdraw-core)
# are letter-adjacent or lowercase and never match these patterns.
BRAND_FILES="apps/web/src/messages/en.json apps/web/src/app/layout.tsx apps/web/src/app/opengraph-image.tsx apps/web/public/site.webmanifest README.md"
for f in $BRAND_FILES; do
  [ -f "$f" ] || continue
  "${SED_I[@]}" \
    -e "s/Quickdraw\([^A-Za-z]\)/${DISPLAY}\1/g" \
    -e "s/Quickdraw\$/${DISPLAY}/" \
    -e "s/\"appName\": \"quickdraw\"/\"appName\": \"${NAME}\"/" \
    -e "s/\"title\": \"quickdraw\"/\"title\": \"${NAME}\"/" \
    "$f"
done

# ── 2. Backend port (targeted patterns — bare '4000' can be a timeout) ─
if [ -n "$PORT" ]; then
  echo "$FILES" | xargs "${SED_I[@]}" \
    -e "s/localhost:4000/localhost:${PORT}/g" \
    -e "s/4000:4000/${PORT}:${PORT}/g" \
    -e "s/BACKEND_PORT=4000/BACKEND_PORT=${PORT}/g" \
    -e "s/BACKEND_PORT:-4000/BACKEND_PORT:-${PORT}/g" \
    -e "s/EXPOSE 4000/EXPOSE ${PORT}/g" \
    -e "s/\[4000,/[${PORT},/g" \
    -e "s/\"4000\":/\"${PORT}\":/g" \
    -e "s/(4000)/(${PORT})/g" \
    -e "s/ports \[4000/ports [${PORT}/g"

  # `?? 4000` fallbacks only where they mean the backend port — a blanket
  # pass would also hit unrelated numeric defaults (e.g. toast durations)
  "${SED_I[@]}" "s/?? 4000/?? ${PORT}/g" \
    apps/api/src/index.ts \
    apps/api/src/auth/google.ts \
    apps/api/src/auth/discord.ts \
    apps/api/src/auth/mock.ts \
    apps/web/src/lib/auth.ts \
    apps/web/src/providers/index.tsx
fi

# ── 3. Package scope (optional) ──────────────────────────────────────
if [ -n "$SCOPE" ]; then
  # Covers package.json names/deps, source imports, AND the turbo
  # --filter=@project/* references in CI/deploy workflows.
  echo "$FILES" | xargs "${SED_I[@]}" "s|@project/|@${SCOPE}/|g"
fi

# ── 4. README: replace the template instructions ─────────────────────
if grep -q "^## Using as Template" README.md; then
  awk -v name="$NAME" '
    /^## Using as Template/ { skip = 1; print "## Template"; print "";
      print "This project was initialized from [quickdraw-chat](https://github.com/fitzzero/quickdraw-chat) via `init-fork.sh " name "`."; print ""; next }
    skip && /^## / { skip = 0 }
    !skip { print }
  ' README.md > README.md.tmp && mv README.md.tmp README.md
fi

# ── 5. Refresh lockfile + formatting ─────────────────────────────────
echo "Installing dependencies (refreshes lockfile)..."
bun install >/dev/null
echo "Formatting..."
bun run format >/dev/null 2>&1 || true

# ── 6. --without-game sanity: a broken seam must fail HERE, loudly ───
if [ -n "$WITHOUT_GAME" ]; then
  echo "Verifying the carve-out (db:generate + build + check + test)..."
  bun run db:generate >/dev/null
  bun run build >/dev/null
  bun run check
  bun run test
fi

echo ""
echo "✅ Initialized '$NAME'. Next steps:"
echo "   1. git add -A && git commit -m 'chore: initialize from template' && git push"
echo "   2. docker-compose up -d        # postgres (db: $DB_NAME)"
echo "   3. bun run db:generate && bun run db:migrate && bun run db:seed"
echo "   4. bun run dev                 # sign in via 'Continue as demo user'"
echo "   5. Point GITHUB_URL in apps/web/src/lib/site.ts at your repo"
echo ""
echo "   Generated by Conveyor? Push and you're done — the board takes it from here."
echo ""

# Self-delete (this script is one-shot by design)
rm -- "$0"
