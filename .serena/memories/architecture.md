# quickdraw-chat Architecture

## Overview

quickdraw-chat is the reference implementation and test application for @fitzzero/quickdraw-core. It demonstrates the full stack patterns with a real-time chat application.

## Monorepo Structure

```
quickdraw-chat/
├── apps/
│   ├── api/              # Express + Socket.io server
│   │   └── src/
│   │       ├── services/ # Business logic (Chat, Message, User)
│   │       ├── auth/     # Discord OAuth, JWT
│   │       └── __tests__/ # Integration tests
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/      # Next.js app router pages
│           ├── components/
│           ├── hooks/    # useService, useSubscription
│           └── providers/
├── packages/
│   ├── db/               # Prisma schema and client
│   ├── shared/           # Shared TypeScript types
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

### Server (apps/api)

Currently uses local BaseService/ServiceRegistry in `src/core/`. These mirror quickdraw-core but import from local packages:

```typescript
// Current (local)
import { BaseService } from "./core/BaseService";

// Target (quickdraw-core) - migrate when stable
import { BaseService } from "@fitzzero/quickdraw-core/server";
```

### Client (apps/web)

Uses local hooks that could migrate to quickdraw-core:

```typescript
// Current (local)
import { useService, useSubscription } from "../hooks";

// Target (quickdraw-core)
import { useService, useSubscription } from "@fitzzero/quickdraw-core/client";
```

## Key Services

| Service | Purpose |
|---------|---------|
| UserService | User profile management, self-access |
| ChatService | Chat rooms with ACL-based membership |
| MessageService | Real-time messaging within chats |

## Development Commands

```bash
pnpm dev          # Start all apps (turbo)
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Push schema to database
pnpm db:studio    # Open Prisma Studio
```
