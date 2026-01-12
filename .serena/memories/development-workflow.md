# Development Workflow

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL (local or Docker)
- Redis (for rate limiting, optional)

### Initial Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp env.example .env.local

# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Start development servers
pnpm dev
```

### Environment Variables

Required in `.env.local`:

```bash
DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat
JWT_SECRET=your-dev-secret-key

# OAuth (optional for local dev - use dev credentials)
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Enable dev auth bypass
ENABLE_DEV_CREDENTIALS=true
```

## Build Commands

```bash
pnpm dev          # Start all apps in watch mode (turbo)
pnpm build        # Build all packages
pnpm typecheck    # TypeScript type checking
pnpm lint         # ESLint across all packages
pnpm test         # Run all tests
pnpm docs:generate # Generate API documentation from services
```

### Package-Specific Commands

```bash
# API server only
pnpm --filter @project/api dev
pnpm --filter @project/api test

# Web client only
pnpm --filter @project/web dev

# Database package
pnpm --filter @project/db generate
pnpm --filter @project/db push
pnpm --filter @project/db studio
```

## Database Workflow

### Schema Changes

1. Edit `packages/db/prisma/schema.prisma`
2. Generate client: `pnpm db:generate`
3. Push to database: `pnpm db:push` (development)
4. For production: Use `pnpm db:migrate` to create migrations

### Prisma Studio

```bash
pnpm db:studio  # Opens browser UI for database inspection
```

### Reset Database

```bash
# In development - drops all data
pnpm db:push --force-reset
```

## Working with quickdraw-core

This project uses a locally-linked `@fitzzero/quickdraw-core`:

```json
// apps/api/package.json
"@fitzzero/quickdraw-core": "link:../../../quickdraw"
```

### Development Workflow

1. Make changes in `quickdraw-core` (sibling project)
2. Run `pnpm build` in quickdraw-core (or have `pnpm dev` running)
3. Changes are immediately available in quickdraw-chat

### Common Scenarios

**Adding a new BaseService feature:**
1. Implement in quickdraw-core's `src/server/BaseService.ts`
2. Build quickdraw-core
3. Use immediately in quickdraw-chat services

**Adding a new client hook:**
1. Implement in quickdraw-core's `src/client/`
2. Export from `src/client/index.ts`
3. Build quickdraw-core
4. Import in quickdraw-chat's web app

## Code Verification

Before committing, run the full check (see `check-code` memory):

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Adding New Features

### New Service

1. Create service file: `apps/api/src/services/<name>/index.ts`
2. Define types in `packages/shared/src/types.ts`
3. Register in `apps/api/src/index.ts`
4. Add integration tests in `apps/api/src/__tests__/services/`

See `service-patterns` memory for implementation details.

### New Page

1. Create page: `apps/web/src/app/<route>/page.tsx`
2. Add to navigation config: `apps/web/src/lib/navigation.ts`
3. Follow patterns in `client-patterns` memory

### New Component

1. Create in appropriate directory under `apps/web/src/components/`
2. Export from the directory's `index.ts`
3. Follow MUI and styling conventions in `client-patterns` memory

## Debugging

### Server Logs

The API server uses structured logging. Set log level via environment:

```bash
LOG_LEVEL=debug pnpm --filter @project/api dev
```

### Socket.io Debugging

```bash
DEBUG=socket.io* pnpm --filter @project/api dev
```

### Database Queries

Enable Prisma query logging:

```typescript
// Temporarily in code
const prisma = new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });
```
