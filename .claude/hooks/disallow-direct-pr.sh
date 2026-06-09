#!/usr/bin/env bash
# PreToolUse hook: blocks direct PR creation commands that should use Conveyor MCP
# Forces use of create_pull_request tool instead of gh CLI or git commands for PR creation

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only enforce the MCP create_pull_request workflow inside a Conveyor *agent*
# context (a task/project runner in a codespace or claudespace), where the PR
# must be linked back to its task. A human maintainer running Claude locally has
# none of these env vars set — let them use gh/git directly; Conveyor still
# auto-syncs a card from the PR via the GitHub webhook.
if [ -z "${CONVEYOR_TASK_ID:-}${CONVEYOR_SESSION_ID:-}${CONVEYOR_TASK_TOKEN:-}${CONVEYOR_PROJECT_TOKEN:-}" ]; then
  exit 0
fi

# Match various forms of direct PR creation commands
if echo "$COMMAND" | grep -qP '(?<!\w)(gh\s+pr\s+create|git\s+request-pull|hub\s+pull-request|glab\s+mr\s+create)'; then
  MATCHED=$(echo "$COMMAND" | grep -oP '(gh\s+pr\s+create|git\s+request-pull|hub\s+pull-request|glab\s+mr\s+create)' | head -1)
  echo "BLOCKED: Use the create_pull_request tool instead of '$MATCHED'."
  echo "Direct PR creation bypasses Conveyor's task management workflow."
  echo "Use: create_pull_request tool with title and body parameters."
  exit 2
fi

# Block curl/wget calls to the GitHub PR creation API
if echo "$COMMAND" | grep -qP '(curl|wget)\s.*api\.github\.com/repos/[^/]+/[^/]+/pulls'; then
  echo "BLOCKED: Use the create_pull_request tool instead of direct GitHub API calls."
  echo "Creating PRs via curl/wget bypasses Conveyor's task management workflow."
  echo "Use: create_pull_request tool with title and body parameters."
  exit 2
fi

exit 0
