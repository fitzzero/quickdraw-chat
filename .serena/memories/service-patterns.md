# Service Architecture Patterns

## Creating a New Service

1. **Create the service file**: `apps/api/src/services/<name>/index.ts`

2. **Extend BaseService from @fitzzero/quickdraw-core**:

```typescript
import type { <Entity>, Prisma, PrismaClient } from "@project/db";
import type { <Entity>ServiceMethods, AccessLevel } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";

export class <Entity>Service extends BaseService<
  <Entity>,
  Prisma.<Entity>CreateInput,
  Prisma.<Entity>UpdateInput,
  <Entity>ServiceMethods
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "<entity>Service", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.<entity>);
    this.initMethods();
  }

  private initMethods(): void {
    // Define methods here
  }
}
```

3. **Define shared types** in `packages/shared/src/types.ts`:

```typescript
export type <Entity>ServiceMethods = {
  create<Entity>: {
    payload: { /* ... */ };
    response: { id: string };
  };
  // ... more methods
};
```

4. **Register the service** in `apps/api/src/index.ts`:

```typescript
import { prisma } from "@project/db";

const <entity>Service = new <Entity>Service(prisma);
serviceRegistry.registerService("<entity>Service", <entity>Service);
```

## Key Differences from Local Core

- Import from `@fitzzero/quickdraw-core/server` instead of local `../../core/BaseService`
- Use `setDelegate(prisma.<entity>)` instead of abstract `getDelegate()` method
- Store `prisma` as instance property for direct queries
- Use `this.prisma.<entity>` for queries instead of `this.db.<entity>`

## Defining Public Methods

Use `defineMethod` with proper typing:

```typescript
this.defineMethod(
  "methodName",        // Method name (matches ServiceMethods key)
  "Read",              // Access level: "Public" | "Read" | "Moderate" | "Admin"
  async (payload, ctx) => {
    // ctx.userId - authenticated user ID
    // ctx.socketId - socket connection ID
    // ctx.serviceAccess - user's service-level permissions
    
    // Implement business logic
    return { /* response matching type */ };
  },
  { resolveEntryId: (p) => p.id } // Optional: for entry-level ACL checks
);
```

## Access Control

**Service-level ACL**: Stored in `user.serviceAccess` JSON field
- Applied automatically via `socket.serviceAccess`
- Checked before entry-level ACL

**Entry-level ACL**: Stored in entity's `acl` JSON field
- Only checked if `hasEntryACL: true`
- Format: `[{ userId: string, level: AccessLevel }]`

**Override `checkAccess`** for custom logic:

```typescript
protected override checkAccess(
  userId: string,
  entryId: string,
  requiredLevel: AccessLevel,
  socket: QuickdrawSocket
): boolean {
  // Self-access example
  return userId === entryId;
}
```

## CRUD Operations

Use BaseService methods for database operations:

```typescript
// These auto-emit to subscribers
await this.create(data);
await this.update(id, data);
await this.delete(id);

// Read operations (no auto-emit)
await this.findById(id);
await this.prisma.<entity>.findMany({ ... });
```

## Event Naming Convention

- Method invocation: `<serviceName>:<methodName>`
- Subscription: `<serviceName>:subscribe`
- Unsubscription: `<serviceName>:unsubscribe`
- Updates: `<serviceName>:update:<entryId>`

## Write Operations Policy

**ALWAYS use BaseService methods for mutations:**
- `this.create()`, `this.update()`, `this.delete()`
- These auto-emit to subscribers and maintain consistency

**AVOID direct Prisma writes:**
- Never use `this.prisma.<entity>.create/update/delete` directly for user-facing operations
- Exception: Read operations and aggregations are fine
