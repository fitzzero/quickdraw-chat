#!/usr/bin/env node
/**
 * Remove Storybook from this repo (config, stories, decorators, docs, CI
 * step, turbo tasks, scripts, dependencies).
 *
 * Called by `init-fork.sh <name> --without-storybook`, or run standalone:
 *
 *   node scripts/strip-storybook.mjs
 *
 * Two mechanisms (mirrors scripts/strip-game.mjs):
 * 1. Delete storybook-only paths outright, including every co-located
 *    *.stories.tsx file.
 * 2. Strip marked blocks from shared files — every storybook insertion into
 *    a shared file sits between the markers
 *    `── quickdraw-storybook:start ──` / `── quickdraw-storybook:end ──`
 *    (any comment syntax). JSON files that can't carry comments
 *    (package.json, turbo.json, .oxlintrc.json) get targeted key removal.
 *
 * Composes with the game carve-out: init-fork.sh runs strip-game first, so
 * its wholesale deletion of game component folders removes their stories
 * before this script's leftover gate runs.
 *
 * Self-deletes on success.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const START = "── quickdraw-storybook:start ──";
const END = "── quickdraw-storybook:end ──";

// ── 1. Whole paths ──────────────────────────────────────────────────────
const DELETE_PATHS = [
  "apps/web/.storybook",
  "apps/web/src/stories",
  "apps/web/storybook-static",
  "docs/storybook.md",
  ".claude/rules/storybook.md",
];

for (const path of DELETE_PATHS) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
    console.log(`  deleted ${path}`);
  }
}

// Co-located stories, wherever a component folder carries them
const storyFiles = execSync('git ls-files "apps/web/src/**/*.stories.tsx"', {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file));
for (const file of storyFiles) {
  rmSync(file);
  console.log(`  deleted ${file}`);
}

// ── 2. Marker-stripped blocks in shared files ───────────────────────────
const tracked = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file));

let strippedCount = 0;
const SELF = "scripts/strip-storybook.mjs";
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

editJson("apps/web/package.json", (data) => {
  delete data.scripts?.storybook;
  delete data.scripts?.["build-storybook"];
  delete data.devDependencies?.storybook;
  delete data.devDependencies?.["@storybook/nextjs-vite"];
  delete data.devDependencies?.["@storybook/addon-docs"];
  delete data.devDependencies?.["@storybook/addon-a11y"];
  // vite was added explicitly for Storybook; vitest ships its own
  delete data.devDependencies?.vite;
});

editJson("package.json", (data) => {
  delete data.scripts?.storybook;
  delete data.scripts?.["build-storybook"];
});

editJson("turbo.json", (data) => {
  delete data.tasks?.storybook;
  delete data.tasks?.["@project/web#build-storybook"];
  // Keep the typecheck override; drop only its storybook input
  const typecheck = data.tasks?.["@project/web#typecheck"];
  if (typecheck?.inputs) {
    typecheck.inputs = typecheck.inputs.filter((input) => !input.includes(".storybook"));
  }
});

editJson(".oxlintrc.json", (data) => {
  data.ignorePatterns = (data.ignorePatterns ?? []).filter(
    (pattern) => !pattern.includes("storybook-static"),
  );
});

// ── 4. Leftover-reference sanity ────────────────────────────────────────
// Deliberate survivors: a changelog is a historical record. bun.lock always
// matches until the reinstall that init-fork.sh runs right after this script.
const LEFTOVER_ALLOWLIST = new Set(["CHANGELOG.md"]);

const leftovers = execSync(
  'git grep -lIi "storybook" -- . ":!scripts/strip-storybook.mjs" ":!scripts/init-fork.sh" ":!bun.lock" || true',
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => !LEFTOVER_ALLOWLIST.has(file));

if (leftovers.length > 0) {
  console.error("\n⚠️  storybook references remain in:");
  for (const file of leftovers) console.error(`   ${file}`);
  process.exit(1);
}

console.log(`\n✅ Storybook removed (${strippedCount} shared files cleaned).`);

// Self-delete (one-shot by design)
rmSync(fileURLToPath(import.meta.url));
