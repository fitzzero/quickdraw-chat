---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "apps/api/src/__tests__/**/*"
  - "apps/web/src/__tests__/**/*"
---

# Testing Patterns

What every service's tests cover (an access matrix, live behavior, budgets,
error codes) and the testing helpers (`createTestApp`, `describeAccessMatrix`,
`expectBudget`, `renderWithQuickdraw`, `createMockClient`) are in the linked
`quickdraw-testing.md`. This is this app's set-up.

## Lanes

- **Unit** (`*.test.ts`, not `.int.`): pure logic, no database
  (`bun run test:unit`): the API's utilities, the PWA helpers.
  <!-- ── quickdraw-game:start ── -->
  Also the bench's metrics, and the shared package's game tests: the sim,
  its loop and the snapshot codec.
  <!-- ── quickdraw-game:end ── -->
- **Integration** (`*.int.test.ts(x)`): the real server against a real
  database (`bun run test:int`). The API's suites are
  `apps/api/src/__tests__/services/*.int.test.ts` (CI shards them by file,
  discovered at run time); the web's is `apps/web/src/__tests__/*.int.test.tsx`.
- `bun run test` runs both. Always through `bun run`, never bare `bun test`.

## The database (dual mode)

`apps/api/src/__tests__/utils/global-setup.ts` and `setup.ts` pick it:

- **No `TEST_DATABASE_URL`** (the local default): each worker boots an
  in-memory PGlite (`openPgliteFromTemplate(TEST_TEMPLATE)`, under jsdom
  too) from a template dump cached by a fingerprint of the migrations
  (`utils/test-template.ts`). No PostgreSQL needed; the API's suites run in
  seconds. Its adapter is wrapped in `withSavepoints`, so a nested
  `tx.$transaction(...)` runs there as on PostgreSQL.
- **`TEST_DATABASE_URL` set** (CI): real PostgreSQL, a database per worker
  cloned from a migrated template.

`beforeEach` truncates every table (`resetDatabase()` from
`@project/db/testing`). Seed with `seedTestUsers()` (an admin, a moderator
and a regular user with fixed grants: never widen them, tests rely on the
exact levels) and the factories in `apps/api/src/__tests__/factories/`
(`createTestUser`, `createTestChat`, `createTestMessage`), which write
through the untracked `testPrisma`.

## The test app

`startTestApp()` (`apps/api/src/__tests__/utils/app.ts`) is quickdraw's
`createTestApp` with:

- every service, over the tracked `testDb`;
- the production grants loader (`User.serviceAccess` over
  `SERVICE_DEFAULT_ACCESS`);
- `strictWarnings: true`, so an N+1 read, an unbounded read or a nested
  write in a call fails the test that made it.
  <!-- ── quickdraw-game:start ── -->
  With the game: a game runtime with a fixed seed and no NPCs (tests drive
  `loop.tickOnce()`; the loop never starts); the game service's own
  `onRoomLeave` and `onHostLeave` run in it as in production, and it serves
  peer links (`peers: true`): `party.int.test.ts` hosts a party with a
  Node client (`defineHost` from the typed client's core) to check them.
  <!-- ── quickdraw-game:end ── -->

Close it in `afterAll`. Then:

- Call as a user with `app.as(user(userId))`, or over a real socket with
  `app.connect(user(userId))`; both load the user's grants at each call, as
  production does. `user(id)` and `agent(id)` (`utils/app.ts`) give the
  principal its kind, without which the app's services refuse every call
  (`FORBIDDEN`). `null` is the anonymous caller.
- `subscribeEntity` and `subscribeScope` in `utils/app.ts` open a row or a
  collection scope over a socket and return the server's answer; assert on
  `app.frames` (`waitFor({ event: "qd:c", userId })`), not internals.
- REST routes under test go on an Express app passed to `startTestApp({ app })`;
  sign in there with `issueSession(keys, userId, { provider: "test" })`.
- The auth routes' own tests build the app's sign-in over the test database
  with `createTestAuth()` (`utils/auth.ts`, a fixed 32-character secret).

## What this app's suites pin

- Each service's `describeAccessMatrix` (in its `*.int.test.ts`): an owner
  or member, a stranger, a service-wide grant where it matters, anonymous,
  and an agent (`agent(id)`) wherever a service or a method narrows its
  `kinds`, with a service-wide grant too (no grant lets an agent past it).
  A mutation that consumes its row takes an `input` factory, so every cell
  gets a fresh row. A change to who may call a method shows up here first.
- The access snapshot (`access-snapshot.int.test.ts`, quickdraw's
  `snapshotAccessMatrix`): every method, entity subscribe and collection
  scope of every service, against one seeded set of rows, as callers at
  each level on the rows (an owner at Admin, a moderator at Moderate, a
  member at Read, a stranger), two with a service-wide grant on every
  service and no row (Admin, Moderate), an agent acting for the owner and
  one for the Admin, and anonymously, in
  `__access__/access-snapshot.int.test.ts.json`. A change that moves a cell
  fails, naming it and whether it opens or closes access; when the change
  is meant, run the suite again with `QD_UPDATE_ACCESS_SNAPSHOT=1` and
  commit the file with it. Under CI (`CI=1`) a missing file, an added or
  removed cell and that variable fail, so the file goes in the commit that
  moved it. A new service needs its row in the suite's `seed` and `rows`.
  Give `inputs` where a made input fails: one its schema refuses is never
  called (it lands in `report.inconclusive`, which the suite asserts is
  empty; never loosen the schema for it), and one naming no user or
  holding no data fails after the access check, so a cell access lets
  through would not say `ok`.
  <!-- ── quickdraw-game:start ── -->
  The seeded world is not the one the sim runs, so the game's play methods
  answer `NOT_FOUND` after their access check and never reach the sim,
  which a reset of the database cannot undo; `scripts/strip-game.mjs`
  drops the game's cells from the file.
  <!-- ── quickdraw-game:end ── -->
- Budgets in `apps/api/src/__tests__/services/__budgets__/`, one file per
  suite: the chat list (30 chats), a message to 3 subscribers, a document
  share with 2 subscribers.
  <!-- ── quickdraw-game:start ── -->
  The game's suite has a player's first join of the world.
  <!-- ── quickdraw-game:end ── -->
  Commit the file `expectBudget` writes; under CI a step that grows (or
  shrinks without a commit) fails.

## Web tests

- `apps/web/src/__tests__/chat.int.test.tsx` renders the real pages and
  components with `renderWithQuickdraw` against the API's test app (the
  web's integration config reuses the API's database set-up, plus
  `dom-setup.ts`, which calls `installJsdomShims()` for what jsdom lacks
  and puts jsdom's storage where Node 25+ hides it; the unit config loads
  it too).
- Component tests without a server use `createMockClient(contracts)`; a
  component that reads `useQuickdraw()` renders inside `mock.$Provider`,
  with the session set by `mock.$session({ userId, serviceAccess, ... })`,
  or by the provider's `session` prop for its subtree alone.
  <!-- ── quickdraw-storybook:start ── -->
  Storybook renders on it too, a provider per story (`storybook.md`).
  <!-- ── quickdraw-storybook:end ── -->
