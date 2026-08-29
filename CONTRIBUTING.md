# Contributing

## Branches

- Open pull requests against **`dev`**. It is the integration branch, and CI
  runs on every push and pull request that targets it.
- **`main`** is the deploy branch. A merge into `main` deploys to production
  through `.github/workflows/deploy.yml`. Never target it directly.
- Conveyor agents work on branches named `conveyor/<card-slug>` and follow the
  same rule.

## Before you push

```bash
bun run check && bun run test
```

`check` runs lint and typecheck; `test` runs the unit and integration lanes.
A husky pre-push hook runs lint and typecheck for you, but it does not run the
tests — run them yourself.

Always use `bun run <script>`, never bare `bun <script>`. Bare `bun test` and
`bun build` invoke bun's own tools instead of the package.json scripts.

## Where to read next

- [CLAUDE.md](CLAUDE.md) — project context, commands, and pointers into
  `.claude/rules/`
- [docs/conveyor-setup.md](docs/conveyor-setup.md) — connecting a fork to
  Conveyor end to end
- [DEPLOYMENT.md](DEPLOYMENT.md) — production deploys
