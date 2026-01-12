# quickdraw-chat

Reference implementation and test application for [@fitzzero/quickdraw-core](https://github.com/fitzzero/quickdraw). A real-time chat application demonstrating the full quickdraw stack.

> **🎉 Production Ready!** This template is now ready to clone for new projects. See [TEMPLATE-READY.md](TEMPLATE-READY.md) for details.

## Purpose

This project serves as:

1. **Test bed** for developing @fitzzero/quickdraw-core features
2. **Reference implementation** showing best practices for quickdraw-based apps
3. **Production-ready template** for starting new quickdraw projects

## Features

- **Real-time chat**: Socket.io for live updates and subscriptions
- **Type-safe**: End-to-end TypeScript with shared types
- **Service-based**: BaseService pattern with auto-wired Socket.io methods
- **Dual ACL patterns**: Membership table (Chat) and JSON ACL (Document) examples
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
│   ├── api/              # Express + Socket.io server
│   │   └── src/
│   │       ├── services/     # Business logic (User, Chat, Message, Document)
│   │       ├── auth/         # JWT and OAuth utilities
│   │       └── __tests__/    # Integration tests
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/          # Next.js app router
│           ├── components/   # React components
│           ├── hooks/        # Typed wrappers for quickdraw-core hooks
│           └── providers/    # QuickdrawProvider, ThemeProvider
├── packages/
│   ├── db/               # Prisma schema and client
│   ├── shared/           # Shared types (ServiceMethodsMap)
│   └── eslint-config/    # Shared ESLint configuration
└── .serena/              # Serena MCP configuration and memories
```

## quickdraw-core Integration

This project imports directly from `@fitzzero/quickdraw-core`:

```json
// package.json (both api and web)
"@fitzzero/quickdraw-core": "link:../../../quickdraw"
```

### Server

```typescript
import {
  ServiceRegistry,
  type QuickdrawSocket,
} from "@fitzzero/quickdraw-core/server";
import { BaseService } from "@fitzzero/quickdraw-core/server";
```

### Client

```typescript
import {
  QuickdrawProvider,
  useQuickdrawSocket,
} from "@fitzzero/quickdraw-core/client";
import { useService, useSubscription } from "@fitzzero/quickdraw-core/client";
```

## Services

| Service         | Purpose                    | ACL Pattern                                 |
| --------------- | -------------------------- | ------------------------------------------- |
| UserService     | User profile management    | Self-access (override `checkAccess`)        |
| ChatService     | Chat rooms with membership | Membership table (`checkEntryACL` override) |
| MessageService  | Real-time messaging        | Inherits from parent chat                   |
| DocumentService | Document collaboration     | JSON ACL (default `checkEntryACL`)          |

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
TEST_DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat_test

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

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback/google

# Client
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## Testing

Integration tests use a real database and socket connections via quickdraw-core testing utilities:

```typescript
import {
  createTestServer,
  emitWithAck,
} from "@fitzzero/quickdraw-core/server/testing";

describe("ChatService", () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;

  beforeAll(async () => {
    server = await createTestServer({ port: 4100 });
    // Register services...
  });

  afterAll(async () => {
    await server.close();
  });

  it("creates chat", async () => {
    const client = await server.connectAs("user-1", { userId: "user-1" });
    const result = await emitWithAck<{ id: string }>(
      client,
      "chatService:createChat",
      {
        title: "Test Chat",
      }
    );
    expect(result.id).toBeDefined();
    client.close();
  });
});
```

## Serena MCP

This project uses Serena for AI-assisted development. Memories are stored in `.serena/memories/`:

- `architecture.md` - Project structure and package relationships
- `service-patterns.md` - How to create and structure services
- `client-patterns.md` - React component and hook patterns
- `testing-patterns.md` - Integration and unit test patterns

## Using as Template

To start a new project from this template:

```bash
# 1. Clone
git clone <this-repo> my-new-project
cd my-new-project

# 2. Customize package names
# - Update all package.json files (@project/* -> @yourproject/*)
# - Update env.example with your database name
# - Update metadata in apps/web/src/app/layout.tsx

# 3. Initialize
cp env.example .env.local
pnpm install
pnpm db:generate
pnpm db:push

# 4. Start developing
pnpm dev
pnpm docs:generate  # Generate API documentation
```

**What's Already Configured:**
- ✅ Dockerfiles for deployment (Vercel, Cloud Run, PM2)
- ✅ Input validation (Zod schemas on all mutations)
- ✅ Security hardening (JWT validation, rate limiting)
- ✅ Error boundaries and graceful shutdown
- ✅ Auto-generated documentation
- ✅ Testing utilities

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment guides covering:
- Vercel (web) + GCP Cloud Run (API)
- Docker Compose
- PM2 on VPS
- Database setup and migrations
- Health checks and monitoring

## License

MIT
