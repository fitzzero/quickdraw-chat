---
paths:
  - "packages/db/**/*"
  - "**/*.prisma"
---

# Database Patterns

```typescript
import { db, prisma } from "@project/db"; // tracked (services), untracked (seeds, sessions)
import type { Chat, Message, Prisma, PrismaClient } from "@project/db";
```

- Schema at `packages/db/prisma/schema.prisma`; the generated client is
  `packages/db/prisma/generated` (gitignored, `bun run db:generate`).
  PascalCase models, `@@map("snake_case")` table names.
- `db` is `trackPrisma(...)` over the same pool: every service writes
  through it, so quickdraw's flush sends entity frames and collection
  deltas (the linked `quickdraw-services.md` has the rules: no nested
  writes, `writes` for other models, `ctx.touch` for raw SQL). `prisma` is
  untracked: seeds, the auth routes' `Session` rows and signing-in users.
  Both are created on first use, so importing the package needs no
  `DATABASE_URL`. One-shot scripts end with `disconnectPrisma()`.
- Access lives in the data three ways, each read by a row policy:
  `User.serviceAccess` (service-wide grants, JSON), `Document.acl` (a
  `[{ userId, level }]` JSON list) and the `ChatMember` membership table.
- A column a collection orders by must be a real column: `Chat.lastMessageAt`
  is maintained by `postMessage` (it defaults to the chat's creation time).
- **Schema changes need a migration**: after editing `schema.prisma`, run
  `bun run db:migrate` (creates the migration and regenerates the client).
  Never `db:push`: the `migrate-check` CI job
  (`prisma migrate diff --exit-code`) fails a schema without its migration.
  Commit `packages/db/prisma/migrations/` with the schema.
- Migrations also feed the test databases: the PGlite template is cached by
  a fingerprint of the migrations and rebuilds when they change.
- Seeding: `packages/db/src/seed.ts` (`bun run db:seed`) creates the demo
  users the mock sign-in picker shows, a welcome chat and a document; keep
  it idempotent.
- Test helpers: `packages/db/src/testing.ts` (`@project/db/testing`):
  `testPrisma` (untracked, for seeding), `testDb` (tracked, for
  `createTestApp`), `resetDatabase()` and `seedTestUsers()`.
- Models: `User`, `Account`, `Session`, `Chat`, `ChatMember`, `Message`,
  `Document`, `PushSubscription`.
  <!-- ── quickdraw-game:start ── -->
  The game adds `GameWorld`, `GameScore` and `Definition`.
  <!-- ── quickdraw-game:end ── -->
