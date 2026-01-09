# API Conventions

## BaseService Pattern

BaseService is the core abstraction for server-side services.

### Type Parameters

```typescript
class MyService extends BaseService<
  TEntity,           // Prisma model type (e.g., Chat)
  TCreateInput,      // Prisma create input type
  TUpdateInput,      // Prisma update input type
  TServiceMethods    // Service method definitions
>
```

### Constructor Pattern

```typescript
constructor() {
  super({
    serviceName: "myService",    // Used for socket events
    hasEntryACL: true,           // Enable entry-level access control
    defaultACL: [],              // Default ACL for new entries
    logger: customLogger,        // Optional custom logger
  });
  this.setDelegate(prisma.myModel);  // Set Prisma delegate
}
```

### Defining Public Methods

Use `defineMethod` for Socket.io-exposed methods:

```typescript
this.defineMethod(
  "methodName",           // Socket event: "serviceName:methodName"
  "Read",                 // Access level: Public, Read, Moderate, Admin
  async (payload, ctx) => {
    // ctx.userId - authenticated user ID
    // ctx.socketId - socket connection ID
    // ctx.serviceAccess - user's service-level permissions
    return { /* response */ };
  },
  {
    schema: zodSchema,    // Optional Zod validation
    resolveEntryId: (p) => p.id,  // For entry-level ACL
  }
);
```

### Access Levels

| Level | Description |
|-------|-------------|
| `Public` | No authentication required |
| `Read` | Authenticated users |
| `Moderate` | Edit access |
| `Admin` | Full access (delete, manage ACL) |

### CRUD Methods

Use inherited methods for database operations (auto-emit to subscribers):

```typescript
await this.create(data);     // Create and emit
await this.update(id, data); // Update and emit
await this.delete(id);       // Delete and emit
await this.findById(id);     // Read only
```

## ServiceRegistry Pattern

Auto-wires service methods to Socket.io:

```typescript
const registry = new ServiceRegistry(io);
registry.registerService("chatService", new ChatService());
// Creates events: chatService:subscribe, chatService:unsubscribe, chatService:methodName
```

## Client Hooks

### useService

For mutations (calling service methods):

```typescript
const createChat = useService("chatService", "createChat", {
  onSuccess: (data) => { /* handle success */ },
  onError: (error) => { /* handle error */ },
});

createChat.mutate({ title: "New Chat" });
```

### useSubscription

For real-time entity data:

```typescript
const { data, isLoading, error } = useSubscription("chatService", chatId);
// Auto-subscribes on mount, updates on server changes
```

## Type Definitions

Service methods are defined in shared types:

```typescript
type ChatServiceMethods = {
  createChat: {
    payload: { title: string };
    response: { id: string };
  };
  // ... more methods
};
```

These provide end-to-end type safety from client to server.
