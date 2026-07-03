---
paths:
  - ".oxlintrc.json"
  - "eslint-plugin-project/**/*"
---

# Linting

Two-layer oxlint setup; all packages lint with `oxlint -c ../../.oxlintrc.json`.

1. **Framework base** — `.oxlintrc.json` extends
   `node_modules/@fitzzero/quickdraw-core/oxlint.base.jsonc`: the strict rule
   set (categories at `deny`, `no-unsafe-*` family, complexity budgets), the
   `quickdraw` jsPlugin, and path-scoped overrides for `services/**`, web/tsx,
   `packages/shared|db`, and tests. It updates with the package — don't copy
   its rules into this repo's config.
2. **Project layer** — `.oxlintrc.json` holds only what is ours: the
   `no-cross-service-mutations` `allowedModels` map, file-specific overrides,
   `ignorePatterns`, and the local `project` plugin
   (`eslint-plugin-project/`, currently `project/no-prisma-in-routes`).

## oxlint extends gotchas

- `overrides` concatenate base-first → a consumer override on the same glob
  wins (that's how the `allowedModels` map relaxes the base's strict default).
- `rules`/`categories` merge per-key, consumer wins.
- **Not inherited**: `ignorePatterns`, `env`, `globals`, `settings` — declare
  them here.
- Keep the explicit `plugins` array mirroring the base; omitting it unions
  oxlint's _default_ plugin set into the merge and produces surprise
  diagnostics.

## Adding a custom rule

See `eslint-plugin-project/README.md`: add `rules/<name>.mjs`, register in
`index.mjs`, enable under `project/<name>` in `.oxlintrc.json` (scoped via
`overrides` when it targets specific paths). Framework-generic rules belong
upstream in quickdraw-core's plugin + base config instead.
