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
import type { EntityCollections, EntityDTO, EntityServiceMethods } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";

export class EntityService extends BaseService<
  Entity, // Prisma row
  Prisma.EntityCreateInput,
  Prisma.EntityUpdateInput,
  EntityServiceMethods,
  Record<string, never>, // TChannels (high-frequency fire-and-forget)
  EntityDTO, // TDto — the wire shape (defaults to the row)
  EntityCollections // TCollections — live lists served by this service
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "entityService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.entity);
    this.defineCollection("byParent", {
      /* see Collections below */
    });
    this.initMethods();
  }

  // Row -> wire DTO (ISO dates, computed fields, joins). Feeds emitUpdate,
  // subscribe payloads, and default collection items. May be async.
  protected override toDto(entity: Entity): EntityDTO {
    return { ...shape };
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
    // Fail fast at construction when the method map and definitions drift
    this.verifyAllMethods(["methodName"]);
  }
}
```

Define shared types as a new module under `packages/shared/src/types/` (one
file per service: DTOs + `<Name>ServiceMethods` + `<Name>Collections`),
register it in `types/service-methods.ts` (ServiceMethodsMap /
SubscriptionDataMap), and register the service in `apps/api/src/index.ts`.
Method-only services (no rows) extend `BaseRpcService` instead.

Lint caps methods at 80 lines — when `initMethods` grows, split it into
focused groups (`initCrudMethods()`, `initQueryMethods()`, …) as the existing
services do. The method-verification helper is `verifyAllMethods([...])`
(there is no `assertAllMethodsDefined`).

Shared cross-service helpers (guards like `requireAuth`, cursor/page
pagination, zod schema builders) live in `apps/api/src/services/shared/` —
use them instead of re-rolling per service.

## Collections — THE pattern for live lists

A collection is "rows of this service, grouped by a scope id derived from the
row". Declare it in the constructor; clients consume it with `useCollection`.
Do NOT hand-emit `*:created`/`*:deleted` room events for row lists (lint:
`quickdraw/no-manual-collection-events`) — that compensation stack is what
collections replace.

```typescript
this.defineCollection("byChat", {
  // Which scope(s) a row belongs to; null = not in the collection;
  // string[] fans out (chatService "myChats" puts one chat in every
  // member's user-id scope)
  resolveScopeId: (message) => message.chatId,
  // ACL, checked once at subscribe. Scope-visible: whoever passes sees
  // every item in full — strip sensitive fields in toItem/snapshot
  checkScopeAccess: (userId, chatId) => this.checkChatAccess(userId, chatId, "Read"),
  // First page + reconnect re-snapshot. Include `ids` (full membership,
  // ids only) so clients prune rows deleted while offline; OMIT ids for
  // unbounded scopes (chat history) so paged-in items survive reconnects
  snapshot: (chatId, { cursor, limit }) => this.byChatSnapshot(chatId, { cursor, limit }),
  // Row -> item DTO for automatic deltas. Default: this service's toDto
  toItem: (message) => this.toDto(message),
});
```

**Automatic emission:** `this.create/update/delete` emit
`added`/`updated`/`removed` deltas to the right scope rooms, including scope
moves and predicate entry/exit. This only works for writes to THIS service's
rows.

**Manual choke points** — for writes the trio can't see:

```typescript
this.emitCollectionUpsert("myChats", userId, item); // junction-table writes (invites)
this.emitCollectionRemove("myChats", userId, chatId); // membership loss
this.emitCollectionReset("byChat", chatId); // bulk ops — clients re-snapshot
await this.kickFromCollection("byChat", chatId, userId); // ACL revocation, adapter-safe
```

Two gotchas proven out in ChatService:

- **Cascade deletes:** if `resolveScopeId` queries related rows (memberships),
  capture the scopes BEFORE `this.delete()` — cascaded children are gone by
  the time the framework resolves the deleted row's scopes (see `deleteChat`).
- **Cross-service refresh:** another service updating your items' derived
  fields calls a public helper on you (messageService's write hooks call
  `chatService.refreshMyChatsItem(chatId)` to keep `lastMessageAt` live).

## Write Lifecycle Hooks

`beforeCreate/afterCreate/beforeUpdate/afterUpdate/beforeDelete/afterDelete`
— cross-cutting side effects without overriding the CRUD trio (see
MessageService keeping chat activity fresh). `before*` may veto by throwing.
When a service has collections or overrides an update/delete hook, writes
fetch the pre-write row (one extra findUnique).

## CRUD Operations

```typescript
// ALWAYS use BaseService methods — they auto-emit to subscribers AND
// notify collections
await this.create(data);
await this.update(id, data);
await this.delete(id); // emits the {id, deleted: true} tombstone itself

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

Live entity emits are two-tier and fixed at subscribe time: elevated
subscribers (owner / service Admin / `hasElevatedAccess` override) join the
`:full` room and get unfiltered payloads; everyone else gets
`getProtectedFields()` stripped. An access change takes effect on
re-subscribe.

## Cross-Service Broadcasting

```typescript
import { serviceRoom } from "@project/shared";

// Custom (non-row-list) events into another service's entity room — always
// use the room helpers, never raw `${service}:${id}` template literals
// (lint-enforced). Type the event in packages/shared/src/types/events.ts
// (QuickdrawEventMap augmentation), never hand-type payloads at call sites.
this.emitToRoom(serviceRoom("chatService", chatId), "chat:memberUpdate", { members });
```

Clients auto-join room `{serviceName}:{entityId}` on subscribe.

<!-- ── quickdraw-game:start ── -->

## High-Frequency Traffic

For tick-rate streams (game input, cursor positions) use quickdraw channels
(`defineChannel`) instead of methods — see `.claude/rules/game-patterns.md`.

<!-- ── quickdraw-game:end ── -->
