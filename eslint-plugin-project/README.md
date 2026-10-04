# eslint-plugin-project

Project-local lint rules, loaded by the root `.oxlintrc.json` via `jsPlugins`
under the `project` namespace. Framework-wide rules live upstream in
`@fitzzero/quickdraw-lint` (the root config extends its
`oxlint.template.jsonc`, which extends `oxlint.base.jsonc`); this plugin is for
patterns specific to _this_ codebase — it survives `scripts/init-fork.sh`
unchanged, so forks keep and extend it.

## Rules

None at the moment. Its one rule, `project/no-prisma-in-routes`, moved
upstream as `quickdraw/no-prisma-in-routes`, which the base config turns on
for `**/routes/**` and `**/routes.*` (the local copy only checked files named
`routes.ts`).

## Adding your own rule

1. Write the rule as an ESLint-compatible module in `rules/<rule-name>.mjs`
   (the rules in `node_modules/@fitzzero/quickdraw-lint/plugin/rules/` are
   good starting points; `no-prisma-in-routes.mjs` is the one that lived here).
2. Register it in `index.mjs` under `rules`.
3. Enable it in the root `.oxlintrc.json` — either in `rules` or scoped to a
   glob in `overrides`:

   ```jsonc
   { "files": ["**/routes.ts"], "rules": { "project/<rule-name>": "error" } }
   ```

4. `bun run lint` to confirm it loads and fires where expected.
