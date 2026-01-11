# Database Patterns

## Schema Location

Prisma schema: `packages/db/prisma/schema.prisma`

## Naming Conventions

### Models

- PascalCase for model names: `User`, `ChatMember`, `Message`
- Use `@@map("table_name")` for snake_case table names in PostgreSQL

### Fields

- camelCase for field names in Prisma: `userId`, `createdAt`
- Use `@map("column_name")` for snake_case column names in PostgreSQL

```prisma
model ChatMember {
  id        String   @id @default(cuid())
  chatId    String   @map("chat_id")
  userId    String   @map("user_id")
  
  @@map("chat_members")
}
```

### Common Field Patterns

```prisma
// Primary key
id        String   @id @default(cuid())

// Timestamps
createdAt DateTime @default(now()) @map("created_at")
updatedAt DateTime @updatedAt @map("updated_at")

// Foreign keys
userId    String   @map("user_id")
user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
```

## Access Control Patterns

### 1. Service-Level ACL (User.serviceAccess)

Stored on User model as JSON. Grants access to ALL entities in a service:

```prisma
model User {
  // { "chatService": "Admin", "documentService": "Read" }
  serviceAccess Json? @map("service_access")
}
```

### 2. JSON ACL Field (Simple Ownership)

Best for: Documents, messages, simple ownership models.

```prisma
model Document {
  // [{ "userId": "...", "level": "Admin" }]
  acl Json?
}
```

**Pros:** Simple, no extra tables, works with BaseService defaults
**Cons:** Can't efficiently query "all documents user X can access"

### 3. Membership Table (Complex Access)

Best for: Chats, teams, any entity with queryable membership.

```prisma
model Chat {
  members ChatMember[]
}

model ChatMember {
  chatId String @map("chat_id")
  userId String @map("user_id")
  level  String @default("Read")  // "Read", "Moderate", "Admin"
  
  @@unique([chatId, userId])
}
```

**Pros:** Queryable relationships, efficient "all chats for user" queries
**Cons:** Extra table, requires `checkEntryACL` override in service

## Relations

### One-to-Many

```prisma
model User {
  messages Message[]
}

model Message {
  userId String @map("user_id")
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### Many-to-Many (via Join Table)

```prisma
model Chat {
  members ChatMember[]
}

model User {
  chatMembers ChatMember[]
}

model ChatMember {
  chat   Chat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([chatId, userId])
}
```

## Indexes

Add indexes for frequently queried fields:

```prisma
model Message {
  chatId    String   @map("chat_id")
  createdAt DateTime @default(now()) @map("created_at")
  
  // Index for fetching messages by chat, ordered by time
  @@index([chatId, createdAt])
}
```

## Database Commands

```bash
# Generate Prisma client after schema changes
pnpm db:generate

# Push schema to database (development)
pnpm db:push

# Create migration (production)
pnpm db:migrate

# Open Prisma Studio
pnpm db:studio

# Reset database (development only)
pnpm db:push --force-reset
```

## Service Integration

### Prisma Client Import

```typescript
import { prisma } from "@project/db";
import type { User, Chat, Prisma } from "@project/db";
```

### In Services

```typescript
export class ChatService extends BaseService<...> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "chatService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.chat);  // For BaseService CRUD
  }
  
  // Use this.prisma for direct queries
  async getChatsForUser(userId: string) {
    return this.prisma.chat.findMany({
      where: { members: { some: { userId } } },
      include: { members: true },
    });
  }
}
```

### Common Queries

```typescript
// Find with relations
const chat = await this.prisma.chat.findUnique({
  where: { id: chatId },
  include: { members: { include: { user: true } } },
});

// Conditional include
const chat = await this.prisma.chat.findUnique({
  where: { id: chatId },
  include: includeMembers ? { members: true } : undefined,
});

// Pagination
const messages = await this.prisma.message.findMany({
  where: { chatId },
  orderBy: { createdAt: "desc" },
  take: 50,
  skip: offset,
});
```

## Testing

### Test Database Setup

```typescript
// packages/db/src/testing.ts
import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient({
  datasources: {
    db: { url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL },
  },
});

export async function resetDatabase() {
  // Order matters for foreign key constraints
  await testPrisma.$executeRaw`TRUNCATE TABLE "messages" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chat_members" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chats" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "documents" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "sessions" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "accounts" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "users" CASCADE`;
}
```

### Seeding Test Data

```typescript
export async function seedTestUsers() {
  return {
    admin: await testPrisma.user.create({
      data: {
        email: "admin@test.com",
        name: "Admin User",
        serviceAccess: { chatService: "Admin", documentService: "Admin" },
      },
    }),
    regular: await testPrisma.user.create({
      data: { email: "user@test.com", name: "Regular User" },
    }),
  };
}
```
