# Code Verification Steps

When asked to "check code" or verify work, run these verification steps in order:

## quickdraw-chat Checks

Run from `quickdraw-chat` workspace root:

```bash
# 1. Lint - catches style issues, unused imports, void expressions
pnpm lint

# 2. Typecheck - catches type errors across all packages
pnpm typecheck

# 3. Test - runs vitest for both api and web packages
pnpm test

# 4. Build (optional) - catches ESM/CJS issues, missing exports
pnpm build
```

## quickdraw-core Checks (if edited)

Run from `quickdraw` workspace root:

```bash
pnpm lint && pnpm typecheck && pnpm build
```

## Variations

- "check code" or "verify" - Full check (all 4 steps)
- "quick check" - Skip build step (faster)
- If quickdraw-core was edited, check both projects

## Reporting

After running checks, report:
- ✅ **Passed** - All checks successful
- ❌ **Failed** - List specific errors and fix them before continuing

## Notes

- Tests run with vitest in both `apps/api` and `apps/web`
- Build step can be slow but catches issues typecheck misses (ESM resolution, bundle errors)
- Always fix issues before marking work complete
