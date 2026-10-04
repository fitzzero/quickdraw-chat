---
paths:
  - ".oxlintrc.json"
  - ".quickdraw-lint-baseline.json"
  - "eslint-plugin-project/**/*"
---

# Linting

Two-layer oxlint setup; all packages lint with `oxlint -c ../../.oxlintrc.json`.

1. **Framework base** — `.oxlintrc.json` extends
   `node_modules/@fitzzero/quickdraw-lint/oxlint.base.jsonc` (the strict rule
   set: categories at `deny`, `no-unsafe-*` family, complexity budgets, the
   `quickdraw` jsPlugin and its rules, overrides for web/tsx,
   `packages/shared|db` and tests) and `oxlint.template.jsonc` (the
   raw-string rules for MUI `Button`, `Typography` and `Tooltip`). They update
   with the package — don't copy their rules into this repo's config.
   `node_modules/@fitzzero/quickdraw-lint/README.md` lists every quickdraw rule.
2. **Project layer** — `.oxlintrc.json` holds only what is ours:
   file-specific overrides, `ignorePatterns`, the baseline setting and the
   local `project` plugin (`eslint-plugin-project/`, no rules at the moment).

## Baseline

`settings.quickdraw.baseline` names `.quickdraw-lint-baseline.json`: the
quickdraw rules' violations recorded when the rules were adopted (the 5.0
migration's leftovers, now only the game's in `apps/api`). A rule reports only
violations the file does not record, and `no-unused-baseline` warns when an
allowance is no longer used: then run `bunx quickdraw-lint baseline` from the
repository root so the file shrinks. Never re-run it to make a new violation
pass. The baseline records quickdraw rules only: a core rule a file breaks
needs an override in `.oxlintrc.json` (none is left).

## oxlint extends gotchas

- `overrides` concatenate base-first → a consumer override on the same glob
  wins.
- `rules`/`categories` merge per-key, consumer wins.
- **Not inherited**: `ignorePatterns`, `env`, `globals`, `settings` — declare
  them here.
- Keep the explicit `plugins` array mirroring the base; omitting it unions
  oxlint's _default_ plugin set into the merge and produces surprise
  diagnostics.
- Globs in `overrides` and `ignorePatterns` match paths as seen from where
  oxlint runs: each package directory. Keep them `**/`-prefixed.

## Adding a custom rule

See `eslint-plugin-project/README.md`: add `rules/<name>.mjs`, register in
`index.mjs`, enable under `project/<name>` in `.oxlintrc.json` (scoped via
`overrides` when it targets specific paths). Framework-generic rules belong
upstream in `@fitzzero/quickdraw-lint` instead.
