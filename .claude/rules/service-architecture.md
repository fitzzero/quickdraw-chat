---
paths:
  - "apps/api/src/services/**/*"
  - "apps/api/src/index.ts"
---

# Service Architecture

All data services in `apps/api/src/services/<name>/index.ts` extend `BaseService` from `@fitzzero/quickdraw-core/server`.

## Creating a New Service

```typescript
import type { Entity, Prisma, PrismaClient } from "@project/db";
import type { EntityServiceMethods, AccessLevel } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";

export class EntityService extends BaseService<
  Entity,
  Prisma.EntityCreateInput,
  Prisma.EntityUpdateInput,
  EntityServiceMethods
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "entityService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.entity);
    this.initMethods();
  }

  private initMethods(): void {
    this.defineMethod(
      "methodName",
      "Read", // "Public" | "Read" | "Moderate" | "Admin"
      async (payload, ctx) => {
        // ctx.userId, ctx.socketId, ctx.serviceAccess
        return {
          /* response */
        };
      },
      {
        schema: z.object({ id: z.string().cuid() }), // Zod validation (lint-enforced)
        resolveEntryId: (p) => p.id, // for entry-level ACL
      },
    );
  }
}
```

Define shared types in `packages/shared/src/types.ts`, register the service in `apps/api/src/index.ts`.

Lint caps methods at 80 lines — when `initMethods` grows, split it into
focused groups (`initCrudMethods()`, `initQueryMethods()`, …) as the existing
services do.

## CRUD Operations

```typescript
// ALWAYS use BaseService methods — they auto-emit to subscribers
await this.create(data);
await this.update(id, data);
await this.delete(id);

// Read operations (no auto-emit, direct Prisma is fine)
await this.findById(id);
await this.prisma.entity.findMany({ ... });
```

Never mutate another service's models directly (lint:
`quickdraw/no-cross-service-mutations`) — call the owning service or add an
explicit `allowedModels` entry in `.oxlintrc.json` with a reason.

## Access Control Patterns

**Access check order:** service-level → `checkAccess()` → `checkEntryACL()` → deny

1. **Service-level** — `user.serviceAccess` JSON field, grants access to all entries of a service
2. **JSON ACL field** — store `acl: [{ userId, level }]` on entity; framework checks automatically (see `DocumentService`)
3. **Membership table** — override `checkEntryACL()` to query a junction table (see `ChatService` + `ChatMember`)
4. **Self-access** — override synchronous `checkAccess()` for user-owns-own-data patterns (see `UserService`)

## Cross-Service Broadcasting

```typescript
import { serviceRoom } from "@project/shared";

// Notify subscribers of another service's entity — always use the room
// helpers, never raw `${service}:${id}` template literals (lint-enforced)
this.emitToRoom(serviceRoom("chatService", chatId), "chat:message", messageDTO);
```

Clients auto-join room `{serviceName}:{entityId}` on subscribe.
