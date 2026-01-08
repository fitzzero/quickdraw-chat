# Fullstack Monorepo Template

A production-ready fullstack monorepo template with real-time capabilities, built with modern patterns and best practices.

## Features

- **Real-time**: Socket.io for live updates and subscriptions
- **Type-safe**: End-to-end TypeScript with shared types
- **Service-based**: BaseService pattern with auto-wired Socket.io methods
- **ACL**: Service-level and entry-level access control
- **Modern React**: TanStack Query for server state management
- **Beautiful UI**: Material-UI with dark theme
- **Testing**: Vitest with integration test utilities
- **Linting**: Strict ESLint config with TypeScript support
- **CI-ready**: Turbo for fast, cached builds

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp env.example .env.local

# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Start development
pnpm dev
```

## Project Structure

```
.
├── apps/
│   ├── api/          # Express + Socket.io server
│   │   └── src/
│   │       ├── services/   # Business logic services
│   │       ├── core/       # BaseService, ServiceRegistry
│   │       └── auth/       # JWT and OAuth utilities
│   └── web/          # Next.js frontend
│       └── src/
│           ├── components/ # React components
│           ├── hooks/      # useService, useSubscription
│           └── providers/  # Socket, Theme, Query providers
├── packages/
│   ├── db/           # Prisma schema and client
│   ├── shared/       # Shared types
│   └── eslint-config/# Shared ESLint configuration
└── .cursor/
    └── rules/        # Cursor AI rules for development
```

## Development

### Adding a New Service

1. Create the service in `apps/api/src/services/<name>/index.ts`
2. Define types in `packages/shared/src/types.ts`
3. Register in `apps/api/src/index.ts`

See `.cursor/rules/service-architecture.mdc` for detailed patterns.

### Adding a New Feature

1. **Backend**: Create service methods with proper ACL
2. **Types**: Add method types to shared package
3. **Frontend**: Use `useService` and `useSubscription` hooks
4. **Tests**: Write integration tests

### Scripts

```bash
# Development
pnpm dev           # Start all apps in dev mode

# Building
pnpm build         # Build all packages
pnpm typecheck     # Type check all packages

# Linting
pnpm lint          # Lint all packages
pnpm lint:fix      # Fix lint issues

# Testing
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage

# Database
pnpm db:generate   # Generate Prisma client
pnpm db:push       # Push schema changes
pnpm db:migrate    # Run migrations
pnpm db:studio     # Open Prisma Studio
```

## Authentication

The template supports:
- **Dev mode**: Set `ENABLE_DEV_CREDENTIALS=true` to auth with just userId
- **JWT**: Create and verify tokens with `createJWT` / `verifyJWT`
- **Discord OAuth**: Configure Discord credentials in `.env.local`
- **Google OAuth**: Configure Google credentials in `.env.local`

## Testing

Integration tests use a real database and socket connections:

```typescript
describe("ChatService", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates chat", async () => {
    const client = await connectAsUser(port, userId);
    const result = await emitWithAck(client, "chatService:createChat", {
      title: "Test",
    });
    expect(result.id).toBeDefined();
  });
});
```

## Deployment

### Environment Variables

Set these in your production environment:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Strong random string for JWT signing
- `NEXT_PUBLIC_API_URL` - Public URL of the API server

### Docker

```dockerfile
# Build
docker build -t app .

# Run
docker run -p 3000:3000 -p 4000:4000 app
```

## License

MIT
