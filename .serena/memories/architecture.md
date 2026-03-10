# quickdraw-chat Architecture

## Overview

quickdraw-chat is the reference implementation and test application for @fitzzero/quickdraw-core. It demonstrates the full stack patterns with a real-time chat application.

## Monorepo Structure

```
quickdraw-chat/
├── apps/
│   ├── api/              # Express + Socket.io server
│   │   └── src/
│   │       ├── services/ # Business logic (User, Chat, Message, Document)
│   │       ├── auth/     # Discord OAuth, JWT
│   │       └── __tests__/ # Integration tests
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/      # Next.js app router pages
│           ├── components/
│           ├── hooks/    # Typed wrappers for quickdraw-core hooks
│           └── providers/
├── packages/
│   ├── db/               # Prisma schema and client
│   ├── shared/           # Shared TypeScript types (ServiceMethodsMap)
│   └── eslint-config/    # Shared ESLint rules
└── .env.local            # Environment variables
```

## Package Dependencies

```
@project/web ──► @project/shared
      │
      └──────► @fitzzero/quickdraw-core/client

@project/api ──► @project/shared
      │
      ├──────► @project/db
      │
      └──────► @fitzzero/quickdraw-core/server
```

## quickdraw-core Integration

Both server and client import directly from `@fitzzero/quickdraw-core`:

```json
// package.json
"@fitzzero/quickdraw-core": "^1.0.0"
```

### Server (apps/api)

```typescript
import { ServiceRegistry, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import { BaseService } from "@fitzzero/quickdraw-core/server";
```

### Client (apps/web)

```typescript
import { QuickdrawProvider, useQuickdrawSocket } from "@fitzzero/quickdraw-core/client";
import { useService, useSubscription } from "@fitzzero/quickdraw-core/client";
```

The `apps/web/src/hooks/` directory contains thin typed wrappers around quickdraw-core hooks, providing project-specific type inference via `ServiceMethodsMap`.

## Key Services

| Service         | Purpose                          | ACL Pattern                                 |
| --------------- | -------------------------------- | ------------------------------------------- |
| UserService     | User profile management          | Self-access (`checkAccess` override)        |
| ChatService     | Chat rooms with membership       | Membership table (`checkEntryACL` override) |
| MessageService  | Real-time messaging within chats | Inherits from parent chat                   |
| DocumentService | Document collaboration example   | JSON ACL (default `checkEntryACL`)          |

## Development Commands

```bash
pnpm dev          # Start all apps (turbo)
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Push schema to database
pnpm db:studio    # Open Prisma Studio
```
