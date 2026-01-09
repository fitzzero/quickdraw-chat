# Development Workflow

## Local Development

### Build Commands

```bash
pnpm build      # Build all exports with tsup
pnpm dev        # Watch mode for development
pnpm typecheck  # TypeScript type checking
pnpm lint       # ESLint
pnpm test       # Run tests with Vitest
```

### Testing with quickdraw-chat

This package is linked locally to quickdraw-chat for real-time development:

```bash
# In quickdraw-chat/apps/api/package.json:
"@fitzzero/quickdraw-core": "link:../../../quickdraw"
```

Changes to quickdraw-core are immediately reflected in quickdraw-chat after rebuild.

**Workflow:**
1. Make changes in quickdraw-core
2. Run `pnpm build` (or have `pnpm dev` running)
3. Changes are instantly available in quickdraw-chat

## Publishing to npm

```bash
# 1. Update version in package.json
# 2. Build
pnpm build

# 3. Publish (requires npm login)
npm publish --access public
```

Package is published as `@fitzzero/quickdraw-core` on npm.

## Adding New Features

### Server-side

1. Add types to `src/server/types.ts`
2. Implement in appropriate file under `src/server/`
3. Export from `src/server/index.ts`
4. Add tests

### Client-side

1. Add types to `src/client/types.ts`
2. Implement component/hook under `src/client/`
3. Export from `src/client/index.ts`
4. Add tests

### Shared Types

1. Add to `src/shared/types.ts`
2. Auto-exported from root package

## Testing

Tests use Vitest. Run with:
```bash
pnpm test           # Single run
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage
```
