# Serena Integration

This monorepo is configured for [Serena](https://oraios.github.io/serena), a semantic code understanding tool that enhances AI-assisted development.

## Configuration

Serena configuration is in `.serena/config.yaml`.

## Features

### Code Navigation

Serena provides semantic understanding of the codebase:
- Jump to definition across packages
- Find all references
- Understand type relationships

### Monorepo Support

The configuration is optimized for this monorepo structure:
- `apps/api` - Express + Socket.io server
- `apps/web` - Next.js frontend
- `packages/db` - Prisma database
- `packages/shared` - Shared types
- `packages/eslint-config` - Shared ESLint rules

### TypeScript Support

Full TypeScript support including:
- Type inference
- Generic types
- Module resolution across packages

## Usage with Cursor

When using Cursor AI, Serena helps:
- Understand service method signatures
- Navigate between server and client code
- Find all usages of shared types
- Refactor safely across packages

## Excluded Paths

For performance, these paths are excluded from indexing:
- `node_modules/`
- `dist/`
- `.next/`
- `coverage/`
- Test files (`*.test.ts`, `*.test.tsx`)
- Prisma migrations
