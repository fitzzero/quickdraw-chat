# quickdraw-chat

Reference implementation and test application for [@fitzzero/quickdraw-core](https://github.com/fitzzero/quickdraw). A real-time chat application demonstrating the full quickdraw stack.

## Purpose

This project serves as:
1. **Test bed** for developing @fitzzero/quickdraw-core features
2. **Reference implementation** showing best practices for quickdraw-based apps
3. **Template validation** ensuring patterns work end-to-end before becoming templates

## Features

- **Real-time chat**: Socket.io for live updates and subscriptions
- **Type-safe**: End-to-end TypeScript with shared types
- **Service-based**: BaseService pattern with auto-wired Socket.io methods
- **ACL**: Service-level and entry-level access control
- **Modern React**: TanStack Query for server state management
- **Beautiful UI**: Material-UI with dark theme
- **Testing**: Vitest with integration test utilities
- **CI-ready**: Turbo for fast, cached builds

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment
cp env.example .env.local
# Edit .env.local with your database credentials

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
│   │       ├── services/   # Business logic (Chat, Message, User)
│   │       ├── core/       # BaseService, ServiceRegistry (local copies)
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
└── .serena/          # Serena MCP configuration and memories
```

## quickdraw-core Integration

This project is linked to quickdraw-core for local development:

```json
// apps/api/package.json
"@fitzzero/quickdraw-core": "link:../../../quickdraw"
```

**Current state**: Using local copies of `BaseService` and `ServiceRegistry` in `apps/api/src/core/`. These mirror quickdraw-core patterns and can be migrated to direct imports once stable:

```typescript
// Current (local)
import { BaseService } from "./core/BaseService";

// Future (from package)
import { BaseService } from "@fitzzero/quickdraw-core/server";
```

## Development

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

### Adding a New Service

1. Create the service in `apps/api/src/services/<name>/index.ts`
2. Define types in `packages/shared/src/types.ts`
3. Register in `apps/api/src/index.ts`
4. Write integration tests

See Serena memory `service-patterns.md` for detailed patterns.

## Authentication

The app supports:
- **Dev mode**: Set `ENABLE_DEV_CREDENTIALS=true` to auth with just userId
- **JWT**: Create and verify tokens with `createJWT` / `verifyJWT`
- **Discord OAuth**: Configure Discord credentials in `.env.local`

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat

# Server
BACKEND_PORT=4000
FRONTEND_PORT=3000

# Auth
JWT_SECRET=your-secret-key
ENABLE_DEV_CREDENTIALS=true  # For local development

# Discord OAuth (optional)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback/discord

# Client
NEXT_PUBLIC_API_URL=http://localhost:4000
```

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

## Serena MCP

This project uses Serena for AI-assisted development. Memories are stored in `.serena/memories/`:

- `architecture.md` - Project structure and package relationships
- `service-patterns.md` - How to create and structure services
- `client-patterns.md` - React component and hook patterns
- `testing-patterns.md` - Integration and unit test patterns

## License

MIT
