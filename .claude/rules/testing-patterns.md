---
paths:
  - "**/*.test.ts"
  - "**/*.int.test.ts"
  - "apps/api/src/__tests__/**/*"
---

# Testing Patterns

Two lanes, split by filename:

- **Unit** (`*.test.ts`, not `.int.`): pure logic, no database. `bun run test:unit`.
- **Integration** (`*.int.test.ts`): real services against a real database.
  `bun run test:int`. Files live at `apps/api/src/__tests__/services/*.int.test.ts`.

## Dual-mode test database

Integration tests pick their database automatically (see
`apps/api/src/__tests__/utils/global-setup.ts`):

- **No `TEST_DATABASE_URL` (local default)** → in-memory PGlite booted from a
  fingerprint-cached template dump. No PostgreSQL needed; the full suite runs
  in seconds. The template rebuilds automatically when migrations change.
- **`TEST_DATABASE_URL` set (CI)** → real PostgreSQL; each vitest worker gets
  its own database cloned from a migrated template DB.

`beforeEach` truncates all tables (`resetDatabase()` from `@project/db/testing`).

## Helpers

- `seedTestUsers()` from `@project/db/testing` — admin / moderator / regular
  with known serviceAccess. Don't widen their access maps; tests rely on the
  exact levels. For custom access, use the factories.
- Factories in `apps/api/src/__tests__/factories/` — `createTestUser()`,
  `createTestChat()`, `createTestMessage()` for arbitrary setups.
- `startTestServer()` (`__tests__/utils/server.ts`) — core's
  `createQuickdrawServer` on an ephemeral port with all services registered
  and the production auth hooks (`createSocketAuth`) against the test DB.
- `connectAsUser(port, userId)` / `emitWithAck(socket, event, payload)` /
  `waitForEvent(socket, event)` from `__tests__/utils/socket.ts`.

## Collection tests

See `collections.int.test.ts` for the pattern. Subscribe via
`emitWithAck(socket, "{service}:collection:subscribe", { collection, scopeId })`
(ack = snapshot; denied = rejected ack). Deltas arrive on the event named
`collectionRoom(service, collection, scopeId)` from `@project/shared` — set up
`waitForEvent` on it BEFORE triggering the write. Cover, per collection: delta
propagation to a second client, scope ACL denial, and (for `ids`-bearing
collections) the reconnect re-snapshot excluding rows deleted while offline.

**Always test these roles:** Admin, Moderator, Entry Admin, Entry Read, Outsider, Self

Admin methods to test: `adminList`, `adminGet`, `adminCreate`, `adminUpdate`, `adminDelete`, `adminMeta`
