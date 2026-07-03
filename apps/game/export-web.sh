#!/usr/bin/env bash
# Export the Godot project to the web app's public directory.
#
# Usage: ./export-web.sh [--debug]
#
# Requires the Godot editor binary (4.7+) and matching web export templates:
#   brew install godot   # macOS
#   godot --headless --path godot --import   # then templates via editor, or:
#   curl -L -o /tmp/tpz https://github.com/godotengine/godot/releases/download/4.7-stable/Godot_v4.7-stable_export_templates.tpz
#   (unzip templates/web_* into ~/Library/Application Support/Godot/export_templates/4.7.stable/)
#
# The exported artifacts (index.js/.wasm/.pck) are COMMITTED so Vercel can
# serve them without running Godot at build time. The engine wasm only
# changes on Godot version bumps; routine game changes rewrite only the pck.
set -euo pipefail

cd "$(dirname "$0")"

GODOT_BIN="${GODOT_PATH:-}"
if [ -z "$GODOT_BIN" ]; then
  for candidate in godot godot4 /Applications/Godot.app/Contents/MacOS/Godot; do
    if command -v "$candidate" >/dev/null 2>&1; then
      GODOT_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$GODOT_BIN" ]; then
  echo "error: Godot binary not found (install with 'brew install godot' or set GODOT_PATH)" >&2
  exit 1
fi

MODE="--export-release"
if [ "${1:-}" = "--debug" ]; then
  MODE="--export-debug"
fi

OUT_DIR="../web/public/game"
mkdir -p "$OUT_DIR"

echo "Importing resources…"
"$GODOT_BIN" --headless --path godot --import >/dev/null 2>&1 || true

echo "Exporting web build ($MODE)…"
"$GODOT_BIN" --headless --path godot "$MODE" web

# Extract the generated engine config so the React wrapper (GodotCanvas)
# always instantiates the engine exactly the way this export expects.
node -e '
  const fs = require("fs");
  const html = fs.readFileSync("'"$OUT_DIR"'/index.html", "utf8");
  const m = html.match(/const GODOT_CONFIG = (\{.*?\});/s);
  if (!m) { console.error("GODOT_CONFIG not found in exported index.html"); process.exit(1); }
  fs.writeFileSync("'"$OUT_DIR"'/engine-config.json", m[1] + "\n");
  console.log("Wrote engine-config.json");
'

# The wrapper page replaces the generated shell; drop files we never serve.
rm -f "$OUT_DIR"/index.html "$OUT_DIR"/index.apple-touch-icon.png "$OUT_DIR"/index.icon.png

echo "Done → $OUT_DIR"
ls -lh "$OUT_DIR"
