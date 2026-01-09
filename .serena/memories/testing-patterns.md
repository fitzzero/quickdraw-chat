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
    │   └── socket.ts       # Socket test helpers
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

```typescript
// apps/api/src/__tests__/utils/socket.ts
import { io as ioClient, Socket } from "socket.io-client";
import type { ServiceResponse } from "@project/shared";

export async function connectAsUser(port: number, userId: string) {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: { userId },
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("Connection timeout")), 5000);
  });

  return socket;
}

export function emitWithAck<TPayload, TResponse>(
  socket: Socket,
  event: string,
  payload: TPayload
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
    
    socket.emit(event, payload, (response: ServiceResponse<TResponse>) => {
      clearTimeout(timeout);
      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}
```

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

## Running Tests

```bash
pnpm test                      # All tests
pnpm --filter @project/api test  # API only
pnpm test:watch                # Watch mode
pnpm test:coverage             # With coverage
```

## Test Environment

Set in `.env.test`:
```
DATABASE_URL=postgresql://dev:dev@localhost:5432/quickdraw_chat_test
ENABLE_DEV_CREDENTIALS=true
LOG_LEVEL=error
```
