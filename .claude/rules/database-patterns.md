---
paths:
  - "packages/db/**/*"
  - "**/*.prisma"
---

# Database Patterns

```typescript
import { prisma } from "@project/db";
import type { User, Chat, Message, Document, Prisma } from "@project/db";
```

- Schema at `packages/db/prisma/schema.prisma`
- PascalCase model names, `@@map("snake_case")` for table names
- Three ACL approaches: `user.serviceAccess` JSON, entity `acl` JSON field, membership table (`ChatMember`)
- **Schema changes MUST have a migration file** — after editing `schema.prisma`,
  run `bun run db:migrate` (prisma migrate dev: creates the migration + regenerates
  the client). Never use `bun run db:push`; it skips migration history and the
  `migrate-check` CI job (`prisma migrate diff --exit-code`) will fail the PR.
- Migration files live in `packages/db/prisma/migrations/` and must be committed alongside the schema change.
- Migrations also feed the test databases: PGlite test templates are
  fingerprint-cached on migration contents and rebuild automatically.
- Seeding: `packages/db/src/seed.ts` (`bun run db:seed`) creates the demo users
  the mock OAuth login picker shows — keep it idempotent.
- Key models: `User`, `Account`, `Session`, `Chat`, `ChatMember`, `Message`, `Document`
