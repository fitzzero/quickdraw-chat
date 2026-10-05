---
paths:
  - "apps/api/src/services/**/*"
  - "apps/api/src/index.ts"
  - "apps/api/src/quickdraw.ts"
  - "packages/shared/src/**/*"
---

# Service Architecture

How quickdraw 5.0 services work (contracts, `qd.defineService`, tracked
writes, collections, kits, access policies) is in the linked rules
`quickdraw-services.md` and `quickdraw-access.md`; to add a service end to
end, use the `quickdraw-new-service` skill. This file is what is particular
to this app.

## Where things live

- **Contracts**: `packages/shared/src/contracts/<service>.ts`, one per
  service, collected in `contracts/index.ts` (the `contracts` map the web
  client is built from, keyed by service name: `qd.chatService`). Schema
  helpers shared by the contracts are in `contracts/helpers.ts`.
- **Named shapes**: `packages/shared/src/types/<service>.ts` names what the
  apps use (`ChatDTO = EntityOf<typeof chatContract>`, `ChatListItem`) and
  holds the wire types no contract owns.
- **Services**: `apps/api/src/services/<name>/index.ts`, each a
  `qd.defineService(contract, {...})` object. `qd` comes from
  `apps/api/src/quickdraw.ts` (the one `initQuickdraw`); never make another.
- **The list**: `apps/api/src/services/index.ts` exports `services`; the API
  server, the MCP server and the tests all take theirs from it, so a new
  service is registered once, there.
  <!-- ── quickdraw-game:start ── -->
  The netcode bench takes it too.
  <!-- ── quickdraw-game:end ── -->
- **Clients**: `db` from `@project/db` is the tracked client every service
  writes through (handlers receive it as `db`); `prisma` is the untracked
  one, for seeds, sessions and sign-in only (`no-untracked-write` lints it).

## The services as examples

| Service           | Row policy                                   | Shows                                                                                                                                                                           |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userService`     | `anyOf(owner("id"), everyone("Read"))`       | public profiles with tiered `fields` (`email`, `serviceAccess` at Admin); grants edited by the admin kit (`grants: true`)                                                       |
| `chatService`     | `members({ model: "chatMember", ... })`      | a membership table changed under the sharing kit's rules (`membership.ts`); `myChats` as a `via` collection (`refreshEntry` keeps `memberCount` live); the `memberUpdate` event |
| `messageService`  | `anyOf(inherit({ from: chat }), owner(...))` | `byChat` anchored on the chat; `writes: ["chat"]` keeps `Chat.lastMessageAt` (the `myChats` order); a detached push                                                             |
| `documentService` | `jsonAcl("acl", { owner: "ownerId" })`       | the read/write, sharing and admin kits only, no hand-written method                                                                                                             |
| `pushService`     | `owner("userId")`                            | a service a REST route calls in process (`push-subscription/rest.ts`)                                                                                                           |

<!-- ── quickdraw-game:start ── -->

The game's two services: `gameService` (on `GameWorld`, `everyone("Read")`)
shows the realtime kit, with a channel, a stream, events and app rooms
(`game-patterns.md`); `definitionService` (no row policy: public reads,
admin kit writes) holds content edited in the admin screens and applied to
the running sim (`onChanged`).

<!-- ── quickdraw-game:end ── -->

## Conventions here

- A method a kit implements but this app writes by hand says why, right
  above it: `// quickdraw: hand-written because it answers { error: ... }`.
  Most do so because the web shows a typed result (`{ error: "name_taken" }`,
  `{ error: "user_not_found" }`) where the kit would throw a code.
- Expected failures throw `QuickdrawError` with a code; a typed `{ error }`
  result is only for a failure a form shows as a normal outcome.
- What a service needs configured at start-up is module state set by each
  root, not constructor arguments: `configurePush` (the push transport),
  `createGameRuntime` (the sim), `onChanged` (definition edits).
- Background work a handler does not await runs in
  `qd.run(fn, { detached: true })` (see `notifyNewMessage`).
- A spot where the framework fell short is marked
  `// quickdraw-5.0 finding: ...` with the smallest workaround; remove both
  once a quickdraw release fixes it.
- Comments in contracts and services say what the code does now, never how
  an older version did it.
- After changing a contract or a service's access, run `bun run docs:generate`
  and commit `docs/api` (CI runs `bun run docs:check`): the pages come from
  the contracts and, with `--services`, the services' access.
