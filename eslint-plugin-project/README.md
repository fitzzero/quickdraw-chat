# eslint-plugin-project

Project-local lint rules, loaded by the root `.oxlintrc.json` via `jsPlugins`
under the `project` namespace. Framework-wide rules live upstream in
`@fitzzero/quickdraw-core/eslint-plugin` (wired by the shared base config);
this plugin is for patterns specific to _this_ codebase — it survives
`scripts/init-fork.sh` unchanged, so forks keep and extend it.

## Rules

- `project/no-prisma-in-routes` — bans direct `prisma.<model>.<method>()`
  calls in `routes.ts` files. REST route handlers stay thin; database access
  belongs in service methods (or a small helper module the route calls).

## Adding your own rule

1. Write the rule as an ESLint-compatible module in `rules/<rule-name>.mjs`
   (copy `rules/no-prisma-in-routes.mjs` as a starting point).
2. Register it in `index.mjs` under `rules`.
3. Enable it in the root `.oxlintrc.json` — either in `rules` or scoped to a
   glob in `overrides`:

   ```jsonc
   { "files": ["**/routes.ts"], "rules": { "project/<rule-name>": "error" } }
   ```

4. `bun run lint` to confirm it loads and fires where expected.
