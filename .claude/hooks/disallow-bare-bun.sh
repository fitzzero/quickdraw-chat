#!/usr/bin/env bash
# PreToolUse hook: blocks bare `bun <script>` commands that should use `bun run <script>`
# These bare commands invoke bun's built-in tools instead of package.json scripts (which route through turbo).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Package.json script names that conflict with or bypass turbo when run as bare bun commands
SCRIPTS="dev|build|build:prod|lint|lint:fix|format|format:check|typecheck|check|test|test:unit|test:int|test:int:watch|test:watch|test:coverage|clean|db:generate|db:push|db:migrate|db:migrate:deploy|db:seed|db:studio|docs:generate|precommit"

# Match `bun <script>` anywhere in the command, with optional trailing args
# but NOT `bun run <script>`, `bun x <script>`, `bunx`, `bun install`, etc.
if echo "$COMMAND" | grep -qP '(?<!\w)bun\s+(?!run\b|x\b|install\b|add\b|remove\b|update\b|link\b|unlink\b|pm\b|init\b|create\b|upgrade\b|completions\b|repl\b|exec\b|--)('"$SCRIPTS"')(\s|$|;|&|\|)'; then
  MATCHED=$(echo "$COMMAND" | grep -oP '(?<!\w)bun\s+('"$SCRIPTS"')(\s|$|;|&|\|)' | head -1 | sed 's/[;&| ]*$//')
  echo "BLOCKED: Use 'bun run <script>' instead of '$MATCHED'."
  echo "Bare bun commands invoke bun built-ins, not the package.json scripts (which route through turbo)."
  exit 2
fi

exit 0
