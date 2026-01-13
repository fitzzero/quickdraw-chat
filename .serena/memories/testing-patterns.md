# Testing Patterns

## Test Organization

```
apps/api/src/
├── services/
│   └── chat/
│       └── index.ts
└── __tests__/
    ├── setup.ts            # Global test setup
    ├── utils/
    │   ├── server.ts       # Test server setup
    │   └── socket.ts       # Socket test helpers (connectAsUser, emitWithAck, etc.)
    └── services/
        └── chat.int.test.ts
```

## Integration Tests (Services)

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";

describe("<Service>Service Integration", () => {
  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
  });

  it("should create entity with proper ACL", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const result = await emitWithAck(client, "chatService:createChat", {
      title: "Test Chat",
    });

    expect(result.id).toBeDefined();
    client.close();
  });

  it("should deny access to non-members", async () => {
    const admin = await connectAsUser(port, users.admin.id);
    const chat = await emitWithAck(admin, "chatService:createChat", {
      title: "Private Chat",
    });
    admin.close();

    const outsider = await connectAsUser(port, users.regular.id);
    await expect(
      emitWithAck(outsider, "chatService:subscribe", { entryId: chat.id })
    ).rejects.toThrow();
    outsider.close();
  });
});
```

## Socket Test Helpers

Socket test utilities are in `apps/api/src/__tests__/utils/socket.ts`:

```typescript
import { connectAsUser, emitWithAck, waitForEvent } from "../utils/socket.js";

// Connect as a user (returns raw Socket)
const client = await connectAsUser(port, userId);

// Emit and wait for response
const result = await emitWithAck(client, "chatService:createChat", {
  title: "Test",
});

// Wait for a real-time event
const update = await waitForEvent(client, `chatService:update:${chatId}`);

// Clean up
client.close();
```

Note: These return raw `Socket` instances. For the `TestClient` wrapper with built-in `emit()` helper, use `@fitzzero/quickdraw-core/server/testing` directly.

## Test Database

```typescript
// packages/db/src/testing.ts
export async function resetDatabase() {
  await testPrisma.$executeRaw`TRUNCATE TABLE "messages" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chat_members" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chats" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "users" CASCADE`;
}

export async function seedTestUsers() {
  return {
    admin: await testPrisma.user.create({
      data: {
        email: "admin@test.com",
        name: "Admin",
        serviceAccess: { chatService: "Admin" },
      },
    }),
    regular: await testPrisma.user.create({
      data: { email: "user@test.com", name: "User" },
    }),
  };
}
```

## ACL Test Scenarios

Always test these scenarios:

1. **Admin** - Service-level Admin access
2. **Moderator** - Service-level Moderate access
3. **Entry Admin** - Entry-level Admin via ACL
4. **Entry Read** - Entry-level Read via ACL
5. **Outsider** - No access (should fail)
6. **Self** - Own data access (if applicable)

## Admin CRUD Tests

Test the BaseService admin methods installed via `installAdminMethods()`:

```typescript
describe("<Service>Service Integration - Admin Methods", () => {
  // Positive tests - admin user (has serviceAccess.<service> = "Admin")
  it("should allow admin to list entities via adminList", async () => {
    const client = await connectAsUser(port, users.admin.id);
    const result = await emitWithAck<
      { page?: number; pageSize?: number },
      { items: Entity[]; total: number; page: number; pageSize: number; totalPages: number }
    >(client, "<service>:adminList", { page: 1, pageSize: 20 });
    expect(result.items).toBeDefined();
    expect(result.total).toBeGreaterThan(0);
    client.close();
  });

  it("should allow admin to get entity by ID via adminGet");
  it("should allow admin to create entity via adminCreate");
  it("should allow admin to update entity via adminUpdate");
  it("should allow admin to delete entity via adminDelete");
  it("should return service metadata via adminMeta");

  // Negative tests - non-admin user (no serviceAccess)
  it("should deny non-admin from using adminList", async () => {
    const client = await connectAsUser(port, users.regular.id);
    await expect(
      emitWithAck(client, "<service>:adminList", {})
    ).rejects.toThrow();
    client.close();
  });

  it("should deny non-admin from using adminCreate");
  it("should deny non-admin from using adminDelete");
});
```

**Key points:**
- Use `users.admin` (has service-level Admin) for positive tests
- Use `users.regular` (no serviceAccess) for negative tests
- Verify database state with `testPrisma` after mutations
- `adminDelete` returns `{ id, success: boolean }` not `{ id, deleted: true }`

## Socket Room Update Tests

Test custom `emitToRoom()` broadcasts (not the standard `emitUpdate()`):

```typescript
describe("<Service>Service Integration - Socket Room Updates", () => {
  it("should broadcast custom event to all room subscribers", async () => {
    const user1 = await connectAsUser(port, users.admin.id);
    const user2 = await connectAsUser(port, users.regular.id);

    // Create entity and give user2 access
    const entity = await emitWithAck(user1, "<service>:create", { ... });
    await emitWithAck(user1, "<service>:invite", { id: entity.id, userId: users.regular.id });

    // BOTH users subscribe to the entity room
    await emitWithAck(user1, "<service>:subscribe", { entryId: entity.id });
    await emitWithAck(user2, "<service>:subscribe", { entryId: entity.id });

    // Set up listener BEFORE triggering the action
    const eventPromise = waitForEvent<EventPayload>(
      user2,
      "custom:eventName",  // The custom event name from emitToRoom()
      3000
    );

    // Trigger action that calls emitToRoom()
    await emitWithAck(user1, "<service>:actionThatEmits", { ... });

    // Verify user2 received the broadcast
    const event = await eventPromise;
    expect(event.someField).toBeDefined();

    user1.close();
    user2.close();
  });
});
```

**Key points:**
- Both users must `subscribe` to join the Socket.io room
- Set up `waitForEvent()` listener BEFORE triggering the action
- Custom events use their own event names (e.g., `chat:memberUpdate`, `chat:message`)
- Standard entity updates use `<service>:update:<entityId>`

## Permission Cascade Tests

Test the full permission hierarchy for methods with `resolveEntryId`:

```
ensureAccessForMethod cascade:
1. Public → Always allowed
2. Service-level access → hasServiceAccess(socket, requiredLevel)
3. Entry-level access (if entryId resolved):
   a. checkAccess() → Custom override in service
   b. checkEntryACL() → ACL array on entity or membership table
4. Read without entryId → Allowed for authenticated users
5. Deny → Insufficient permissions
```

```typescript
describe("<Service>Service Integration - Permission Cascade", () => {
  // Service-level access (user NOT a member, but has serviceAccess)
  it("should allow service-level Moderate access", async () => {
    // users.moderator has serviceAccess.chatService = "Moderate"
    const client = await connectAsUser(port, users.moderator.id);
    // Can perform action even without being a member
    const result = await emitWithAck(client, "<service>:moderateAction", { id: entityId });
    expect(result).toBeDefined();
    client.close();
  });

  // Entry-level access (user IS a member with sufficient level)
  it("should allow entry-level Moderate access", async () => {
    // Invite user with Moderate level
    await emitWithAck(admin, "<service>:invite", { id: entityId, userId: users.regular.id, level: "Moderate" });
    const client = await connectAsUser(port, users.regular.id);
    const result = await emitWithAck(client, "<service>:moderateAction", { id: entityId });
    expect(result).toBeDefined();
    client.close();
  });

  // Higher level is sufficient (Admin > Moderate > Read)
  it("should allow service-level Admin for Moderate-required action");

  // Deny: insufficient entry-level access
  it("should deny entry-level Read for Moderate-required action", async () => {
    await emitWithAck(admin, "<service>:invite", { id: entityId, userId: users.regular.id, level: "Read" });
    const client = await connectAsUser(port, users.regular.id);
    await expect(
      emitWithAck(client, "<service>:moderateAction", { id: entityId })
    ).rejects.toThrow();
    client.close();
  });

  // Deny: not a member and no service-level access
  it("should deny non-member without service access");
});
```

**Key points:**
- Test both service-level AND entry-level access paths
- Verify higher levels work (Admin can do Moderate actions)
- Test deny cases: insufficient level, non-member
- Access levels: Public < Read < Moderate < Admin

## Running Tests

```bash
pnpm test                      # All tests
pnpm --filter @project/api test  # API only
pnpm test:watch                # Watch mode
pnpm test:coverage             # With coverage
```

## Test Environment

Tests load environment variables from `.env.local` via `dotenv-cli` in the package.json test scripts:

```json
"test": "dotenv -e ../../.env.local -- vitest run"
```

**Required in `.env.local`:**

```bash
DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat
# Optional: Use separate test database
TEST_DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat_test
```

**Automatically set by test setup:**

```
NODE_ENV=test
ENABLE_DEV_CREDENTIALS=true
```

**Important:** Always run tests via `pnpm test`, not `npx vitest run` directly.
