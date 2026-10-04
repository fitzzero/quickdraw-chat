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
 *    (any comment syntax). JSON files (en.json, package.json, the
 *    lint baseline, and .oxlintrc.json, whose JSONC comments are dropped)
 *    get targeted key removal below.
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
  "apps/api/src/__tests__/services/__budgets__/game.int.test.ts.json",
  "apps/api/src/__tests__/services/definition.int.test.ts",
  "apps/api/src/__tests__/services/discord-activity.int.test.ts",
  "apps/api/src/__tests__/services/guest-auth.int.test.ts",
  "packages/shared/src/types/game.ts",
  "packages/shared/src/types/definition.ts",
  "packages/shared/src/contracts/game.ts",
  "packages/shared/src/contracts/definition.ts",
  "packages/shared/src/game",
  "packages/bench",
  "apps/api/src/bench",
  "apps/bench-web",
  "bench-baselines",
  "bench-results",
  "docs/netcode-bench.md",
  "docs/netcode-rd",
  ".claude/skills/netcode-rd",
  ".claude/rules/game-patterns.md",
  "docs/api/gameService.md",
  "docs/api/definitionService.md",
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
/**
 * Parses JSON with comments and trailing commas, as .oxlintrc.json is
 * written (oxlint reads JSONC). The file is written back as plain JSON, so
 * its comments are dropped: the formatter then lays it out.
 */
function parseJsonc(text) {
  let json = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      json += char;
      if (char === "\\") {
        i += 1;
        json += text[i] ?? "";
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      json += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      json += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 1;
    } else {
      json += char;
    }
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, "$1"));
}

function editJson(path, edit) {
  const data = parseJsonc(readFileSync(path, "utf8"));
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
    delete data.Landing.featGameDetail;
    // Copy that names the game needs replacing, not deleting — these keys
    // are rendered on the landing page.
    data.Landing.subtitle =
      "Typed Socket.IO services, two-tier access control, and a full auth suite — already wired together. Fork it and build the interesting part.";
    data.Landing.featAuthDesc =
      "Google & Discord OAuth, revocable sessions, and a mock OAuth flow so local dev never needs real credentials.";
    data.Landing.featAuthDetail =
      "Sessions are JWTs paired with revocable database rows, carried only in an httpOnly cookie — the same credential authenticates REST and every socket. The mock OAuth provider runs a genuine code flow against seeded users and hard-blocks production boot.";
    data.Landing.featAdminDesc =
      "Every service gets an admin CRUD surface for free — no per-service admin pages to build.";
    data.Landing.featAdminDetail =
      "installAdminMethods exposes list/get/create/update/delete with per-action access levels, and the generic /admin UI renders tables and editors from the schema.";
    // init-fork.sh self-deletes after it runs, so its copy has to stop
    // describing options the reader no longer has.
    data.Landing.featForkDesc =
      "init-fork.sh renamed the whole identity for this project — app, database and deploy targets — then deleted itself.";
    data.Landing.featForkDetail =
      "One script rewrote databases, display names, deploy service names, the devcontainer, and optionally the backend port and package scope. It verified the result built before it finished.";
  }
  if (data.ProfilePage) {
    data.ProfilePage.displayNameHint = "Your display name is shown to other people in chats.";
  }
});

editJson("apps/web/public/site.webmanifest", (data) => {
  data.description = "Realtime chat starter — typed Socket.IO services, ACL, and auth.";
});

editJson("apps/web/package.json", (data) => {
  delete data.dependencies?.["@discord/embedded-app-sdk"];
});

editJson("package.json", (data) => {
  delete data.scripts?.["bench:netcode"];
  delete data.scripts?.["bench:server"];
  delete data.scripts?.["bench:compare"];
  delete data.scripts?.["check:godot"];
});

editJson("apps/api/package.json", (data) => {
  delete data.scripts?.["bench:netcode"];
  delete data.scripts?.["bench:server"];
  delete data.scripts?.["check:godot"];
  delete data.dependencies?.["@project/bench"];
});

// Lint allowances recorded for files DELETE_PATHS removed (a fork that adopted
// a new rule with `quickdraw-lint baseline` has one)
if (existsSync(".quickdraw-lint-baseline.json")) {
  editJson(".quickdraw-lint-baseline.json", (data) => {
    for (const file of Object.keys(data.files ?? {})) {
      if (!existsSync(file)) delete data.files[file];
    }
  });
}

// docs/api/README.md is generated (`bun run docs:generate`, quickdraw-docs)
// and indexes the service pages. Drop the rows of the two whose pages
// DELETE_PATHS just removed; init-fork.sh then generates the whole reference
// again (run `bun run docs:generate` yourself after running this alone), which
// also lays the table out for the services left.
const apiDocsIndex = "docs/api/README.md";
if (existsSync(apiDocsIndex)) {
  const kept = readFileSync(apiDocsIndex, "utf8")
    .split("\n")
    .filter((line) => !/^\| \[(game|definition)Service\]/.test(line))
    .join("\n");
  writeFileSync(apiDocsIndex, kept);
  console.log(`  edited ${apiDocsIndex}`);
}

editJson(".oxlintrc.json", (data) => {
  for (const override of data.overrides ?? []) {
    const rule = override.rules?.["quickdraw/no-cross-service-mutations"];
    if (Array.isArray(rule) && rule[1]?.allowedModels) {
      delete rule[1].allowedModels.game;
    }
  }
  // The bench override targets paths DELETE_PATHS removes.
  data.overrides = (data.overrides ?? []).filter(
    (override) => !override.files?.some((glob) => glob.includes("bench")),
  );
});

// ── 4. Leftover-reference sanity ────────────────────────────────────────
// Deliberate survivors. Each one is generic code or copy that merely reads as
// game-adjacent; deleting them would be a regression, not a cleanup.
const LEFTOVER_ALLOWLIST = new Set([
  // Structural probe for the guest-auth field. The hook stays generic: the
  // field only exists when the guest-auth feature does, and the comment above
  // it says so.
  "apps/web/src/hooks/useFilteredNavigation.ts",
  // A changelog is a historical record. Entries stay as they were written.
  "CHANGELOG.md",
]);

const LEFTOVER_PATTERN = [
  "godot",
  "quickdraw-game",
  "gameService",
  "definitionService",
  "GodotCanvas",
  "bench:netcode",
  "multiplayer game",
  "Discord Activity",
  "high-scores",
].join("\\|");

const leftovers = execSync(
  `git grep -lIi "${LEFTOVER_PATTERN}" -- . ":!scripts/strip-game.mjs" ":!scripts/init-fork.sh" || true`,
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => existsSync(file))
  .filter((file) => !LEFTOVER_ALLOWLIST.has(file));

if (leftovers.length > 0) {
  console.error("\n⚠️  game references remain in:");
  for (const file of leftovers) console.error(`   ${file}`);
  process.exit(1);
}

console.log(`\n✅ Game foundation removed (${strippedCount} shared files cleaned).`);

// Self-delete (one-shot by design)
rmSync(fileURLToPath(import.meta.url));
