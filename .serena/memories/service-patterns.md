# Service Architecture Patterns

## Creating a New Service

1. **Create the service file**: `apps/api/src/services/<name>/index.ts`

2. **Extend BaseService with proper types**:

```typescript
import type { <Entity>, Prisma } from "@prisma/client";
import type { <Entity>ServiceMethods, AccessLevel } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "../../core/BaseService";

export class <Entity>Service extends BaseService<
  <Entity>,
  Prisma.<Entity>CreateInput,
  Prisma.<Entity>UpdateInput,
  <Entity>ServiceMethods
> {
  constructor() {
    super({ serviceName: "<entity>Service", hasEntryACL: true });
    this.initMethods();
  }

  protected getDelegate() {
    return this.db.<entity>;
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
const <entity>Service = new <Entity>Service();
serviceRegistry.registerService("<entity>Service", <entity>Service);
```

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
await this.db.<entity>.findMany({ ... });
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
- Never use `this.db.<entity>.create/update/delete` directly for user-facing operations
- Exception: Read operations and aggregations are fine
