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

Use `defineMethod` with proper typing and Zod validation:

```typescript
import { z } from "zod";

// Define Zod schema for validation
const myMethodSchema = z.object({
  id: z.string().cuid("Invalid ID"),
  title: z.string().min(1).max(100),
  content: z.string().max(10000).optional(),
});

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
  { 
    schema: myMethodSchema,           // Zod validation (recommended)
    resolveEntryId: (p) => p.id       // Optional: for entry-level ACL checks
  }
);
```

**Best Practices:**
- ✅ Always add Zod schemas for user-facing mutations
- ✅ Set reasonable length limits (titles: 100 chars, content: 10KB)
- ✅ Validate IDs with `.cuid()` or `.uuid()`
- ✅ Use `.enum()` for restricted values

## Access Control

BaseService supports three ACL patterns. Choose based on your entity's needs:

### 1. Service-Level ACL (Always Active)

Stored in `user.serviceAccess` JSON field, checked first for all methods:
```typescript
// User has serviceAccess: { "chatService": "Admin", "messageService": "Admin" }
// This grants Admin access to ALL chats and messages regardless of entry ACL
```

### 2. Built-in JSON ACL (Document/Message Pattern)

**Best for:** Simple ownership models, entities where creator owns the record.

**Setup:**
```typescript
// In constructor
super({ serviceName: "messageService", hasEntryACL: true });

// When creating, add creator to ACL
const message = await this.prisma.message.create({
  data: {
    ...payload,
    acl: [{ userId: ctx.userId, level: "Admin" }], // Creator is Admin
  },
});

// Method requires Admin - framework checks ACL automatically
this.defineMethod("deleteMessage", "Admin", async (payload, _ctx) => {
  await this.prisma.message.delete({ where: { id: payload.id } });
  return { id: payload.id, deleted: true as const };
}, { resolveEntryId: (p) => p.id });
```

**See:** `DocumentService`, `MessageService`

### 3. Membership Table Pattern (Chat Pattern)

**Best for:** Complex membership with queryable relationships ("all chats user X can access").

**Setup:**
```typescript
// In constructor - still set hasEntryACL: true
super({ serviceName: "chatService", hasEntryACL: true });

// Override checkEntryACL to use membership table
protected override async checkEntryACL(
  userId: string,
  chatId: string,
  requiredLevel: AccessLevel
): Promise<boolean> {
  const member = await this.prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { level: true },
  });
  if (!member) return false;
  return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
}
```

**See:** `ChatService`

### 4. Self-Access Override (User Pattern)

**Best for:** Users accessing their own data.

**Setup:**
```typescript
// In constructor - no entry ACL needed
super({ serviceName: "userService", hasEntryACL: false });

// Override synchronous checkAccess for self-access
protected override checkAccess(
  userId: string,
  entryId: string,
  requiredLevel: AccessLevel,
  _socket: QuickdrawSocket
): boolean {
  if (requiredLevel === "Read") return true; // Anyone can read profiles
  return userId === entryId; // Only self can write
}
```

**See:** `UserService`

### Access Check Order

1. Service-level access (`socket.serviceAccess[serviceName]`) - if sufficient, grants access
2. `checkAccess()` override (synchronous) - for simple patterns like self-access
3. `checkEntryACL()` override (async) - for entry-level ACL (JSON field or membership table)
4. If all fail, throws "Insufficient permissions"

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

## Cross-Service Room Broadcasting

When Service A needs to notify subscribers of Service B (e.g., MessageService notifying ChatService subscribers):

```typescript
// Emit to all subscribers of another service's entity
this.emitToRoom(
  `chatService:${chatId}`,  // Room name: {serviceName}:{entityId}
  "chat:message",           // Custom event name
  messageDTO                 // Data payload
);
```

**How it works:**
- When clients subscribe to an entity, they auto-join the Socket.io room `{serviceName}:{entityId}`
- Any service can emit to that room using `emitToRoom()`
- Uses `io.to(room).emit()` which sends to ALL sockets in the room

**Common use cases:**
- New messages in a chat: `chat:message`
- Message deletions: `chat:messageDelete`
- Typing indicators: `chat:typing`
- Any "broadcast to entity subscribers" scenario

**Client-side pattern:**

```typescript
useEffect(() => {
  socket.on("chat:message", handleNewMessage);
  socket.on("chat:messageDelete", handleDelete);
  return () => {
    socket.off("chat:message", handleNewMessage);
    socket.off("chat:messageDelete", handleDelete);
  };
}, [socket, chatId]);
```
