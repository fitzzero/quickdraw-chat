---
paths:
  - ".oxlintrc.json"
  - "eslint-plugin-project/**/*"
---

# Linting

oxlint, run per package by turbo (`bun run lint`, each package's
`oxlint -c ../../.oxlintrc.json src`), in two layers:

1. **The framework's** — `.oxlintrc.json` extends
   `node_modules/@fitzzero/quickdraw-lint/oxlint.template.jsonc`, which
   extends `oxlint.base.jsonc` (the strict categories, the `no-unsafe-*`
   family, complexity budgets, the `quickdraw` plugin's rules and its path
   overrides for the web app, `packages/shared|db` and tests) and adds the
   design-system rules (no raw strings in MUI `Button`, `Typography` and a
   `Tooltip`'s `title`). They update with the package: never copy their
   rules here. `node_modules/@fitzzero/quickdraw-lint/README.md` lists every
   quickdraw rule; the linked `quickdraw-services.md` and
   `quickdraw-client.md` say what each one protects.
2. **This app's** — `.oxlintrc.json` holds only what is ours: the
   `plugins` list, `ignorePatterns`, file overrides
   <!-- ── quickdraw-game:start ── -->
   (the netcode bench drives raw sockets and prints, on purpose)
   <!-- ── quickdraw-game:end ── -->
   and the local `project` plugin (`eslint-plugin-project/`, no rules yet).

Fix the code, not the rule. A rule that must not apply to one line takes an
`// oxlint-disable-next-line <rule> -- <why>` comment; a whole kind of file,
an override here with a reason.

## A new rule with old violations

There is no baseline: the app has no violations left. To adopt a new rule
before its old violations are fixed, record them with
`node_modules/.bin/quickdraw-lint baseline` (it writes
`.quickdraw-lint-baseline.json`), name the file in
`settings.quickdraw.baseline`, and lint with `quickdraw-lint check`
instead of plain oxlint until the baseline is empty again. Never re-run the
baseline to let a new violation through.

## oxlint extends gotchas

- `overrides` concatenate base first, so an override here on the same glob
  wins; `rules` and `categories` merge per key, this file winning.
- **Not inherited**: `ignorePatterns`, `env`, `globals`, `settings`: declare
  them here.
- Keep the explicit `plugins` array: leaving it out unions oxlint's default
  plugins into the merge and brings surprise diagnostics.
- Globs in `overrides` and `ignorePatterns` match paths as seen from where
  oxlint runs, each package directory: keep them `**/`-prefixed.

## Adding a custom rule

See `eslint-plugin-project/README.md`: add `rules/<name>.mjs`, register it in
`index.mjs`, enable it as `project/<name>` in `.oxlintrc.json` (in an
override when it targets some paths). A rule every quickdraw app should have
belongs upstream in `@fitzzero/quickdraw-lint`.
