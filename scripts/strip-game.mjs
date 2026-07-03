#!/usr/bin/env node
/**
 * Remove the entire game foundation from this repo (Godot app, GameService,
 * DefinitionService, Discord Activity, overlays, migrations, docs).
 *
 * Called by `init-fork.sh <name> --without-game`, or run standalone:
 *
 *   node scripts/strip-game.mjs
 *
 * Two mechanisms:
 * 1. Delete game-only paths outright.
 * 2. Strip marked blocks from shared files — every game insertion into a
 *    shared file sits between the markers
 *    `── quickdraw-game:start ──` / `── quickdraw-game:end ──`
 *    (any comment syntax). JSON files that can't carry comments (en.json,
 *    package.json, .oxlintrc.json) get targeted key removal below.
 *
 * Self-deletes on success.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const START = "── quickdraw-game:start ──";
const END = "── quickdraw-game:end ──";

// ── 1. Whole paths ──────────────────────────────────────────────────────
const DELETE_PATHS = [
  "apps/game",
  "apps/web/public/game",
  "apps/web/src/app/game",
  "apps/web/src/app/discord",
  "apps/web/src/app/scores",
  "apps/web/src/components/game",
  "apps/web/src/components/discord",
  "apps/web/src/lib/godot-engine.d.ts",
  "apps/api/src/services/game",
  "apps/api/src/services/definition",
  "apps/api/src/auth/discord-activity.ts",
  "apps/api/src/auth/guest.ts",
  "apps/api/src/__tests__/services/game.int.test.ts",
  "apps/api/src/__tests__/services/definition.int.test.ts",
  "apps/api/src/__tests__/services/discord-activity.int.test.ts",
  "apps/api/src/__tests__/services/guest-auth.int.test.ts",
  "packages/shared/src/types/game.ts",
  "packages/shared/src/types/channels.ts",
  "packages/shared/src/types/definition.ts",
  ".claude/rules/game-patterns.md",
];

for (const path of DELETE_PATHS) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
    console.log(`  deleted ${path}`);
  }
}

// Game-only migrations (safe: forks start on fresh databases)
const migrationsDir = "packages/db/prisma/migrations";
const gameMigrations = execSync(`ls ${migrationsDir}`, { encoding: "utf8" })
  .split("\n")
  .filter((name) => /_game_foundation$|_definitions$|_guest_users$/.test(name));
for (const name of gameMigrations) {
  rmSync(join(migrationsDir, name), { recursive: true });
  console.log(`  deleted ${migrationsDir}/${name}`);
}

// ── 2. Marker-stripped blocks in shared files ───────────────────────────
const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file));

let strippedCount = 0;
const SELF = "scripts/strip-game.mjs";
for (const file of tracked) {
  if (file === SELF) continue; // the docstring mentions the markers
  const content = readFileSync(file, "utf8");
  if (!content.includes(START)) continue;

  const lines = content.split("\n");
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.includes(START)) {
      inBlock = true;
      continue;
    }
    if (line.includes(END)) {
      inBlock = false;
      continue;
    }
    if (!inBlock) kept.push(line);
  }
  writeFileSync(file, kept.join("\n"));
  strippedCount++;
  console.log(`  stripped markers in ${file}`);
}

// ── 3. JSON files (no comment markers possible) ─────────────────────────
function editJson(path, edit) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  edited ${path}`);
}

editJson("apps/web/src/messages/en.json", (data) => {
  delete data.GamePage;
  delete data.GameHud;
  delete data.GameChat;
  delete data.GameDialog;
  delete data.ScoresPage;
  delete data.DiscordActivity;
  if (data.Nav) {
    delete data.Nav.game;
    delete data.Nav.scores;
  }
  if (data.Landing) {
    delete data.Landing.ctaPlay;
    delete data.Landing.featGameTitle;
    delete data.Landing.featGameDesc;
  }
});

editJson("apps/web/package.json", (data) => {
  delete data.dependencies?.["@discord/embedded-app-sdk"];
});

editJson(".oxlintrc.json", (data) => {
  for (const override of data.overrides ?? []) {
    const rule = override.rules?.["quickdraw/no-cross-service-mutations"];
    if (Array.isArray(rule) && rule[1]?.allowedModels) {
      delete rule[1].allowedModels.game;
    }
  }
});

// ── 4. Leftover-reference sanity ────────────────────────────────────────
const leftovers = execSync(
  'git grep -lI "gameService\\|definitionService\\|quickdraw-game\\|GodotCanvas" -- . ":!scripts/strip-game.mjs" ":!scripts/init-fork.sh" || true',
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file));

if (leftovers.length > 0) {
  console.error("\n⚠️  game references remain in:");
  for (const file of leftovers) console.error(`   ${file}`);
  process.exit(1);
}

console.log(`\n✅ Game foundation removed (${strippedCount} shared files cleaned).`);

// Self-delete (one-shot by design)
rmSync(fileURLToPath(import.meta.url));
