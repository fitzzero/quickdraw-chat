# Core 4.0 follow-up — friction found while making quickdraw-chat the collections demo

> **Status: point-in-time feedback, written 2026-07-28 against core 4.0.**
> This repo now runs core 4.1.x, so some items may already be resolved
> upstream. Check the current core release notes before acting on anything
> here.

Feedback for `@fitzzero/quickdraw-core` from the 4.0 migration + RFC 0001
Phase 3 work (2026-07-28). Everything below has a working workaround in this
repo; file references point at the demonstration sites.

## Server

1. **`createQuickdrawServer` cannot host an app with a REST surface.** It
   builds its own Express app (health check only), doesn't return it, and
   its `cors.origin` accepts only `string | string[]` — no origin function.
   This template needs OAuth routes, helmet, cookie parsing, raw-body
   capture, and a codespaces-aware CORS function, so production
   (`apps/api/src/index.ts`) re-implements ~40 lines of the middleware +
   connection lifecycle around the same `authenticate`/`loadServiceAccess`
   hooks (the test server uses `createQuickdrawServer` directly — the hooks
   contract itself is right). Wanted: accept an existing `app`/`httpServer`
   (or export `applyQuickdrawSocketAuth(io, auth)` +
   `attachConnectionLifecycle(io, registry)` so composition roots stay
   one-liners), and accept a CORS origin function.

2. **Async `resolveScopeId` silently misses deletes under FK cascades.**
   `BaseService.delete()` resolves the deleted row's scopes _after_
   `delegate.delete`, so a resolver that queries related rows (myChats
   resolves chat → member userIds) sees cascade-deleted children as `[]` and
   emits nothing. Workaround: capture scopes before deleting and emit
   `emitCollectionRemove` manually (`ChatService.deleteChat`). Wanted:
   resolve `before`-scopes before the delegate delete inside the trio (the
   row is already fetched), or at minimum a loud doc callout on
   `defineCollection`.

3. **Junction-table membership scopes need a doc callout.** RFC 0001's own
   headline example (`resolveScopeId: (chat) => memberUserIds(chat)`)
   implies membership _writes_ stay live — but invites/removals are
   ChatMember writes, invisible to the Chat CRUD trio, so every membership
   mutation needs manual choke-point emission (`refreshMyChatsItem` +
   `emitCollectionRemove` in `ChatService`). The choke points handle it
   fine; the fan-out example just needs to say this out loud. Same for
   derived item fields owned by another service: `lastMessageAt` stays live
   only because `MessageService.afterCreate/afterDelete` call back into
   `chatService.refreshMyChatsItem` — worth blessing as the cross-service
   refresh pattern.

4. **No public tombstone emitter.** `delete()` casts
   `{ id, deleted: true } as unknown as Partial<TDto>` internally; any
   hand-rolled delete path has to reproduce that cast. A public
   `emitDeleted(entryId)` would keep app code cast-free (this template
   dodged it by routing all deletes through `this.delete()`).

5. **`toDto` runs twice per write on collection services.** `create()` maps
   the row for `emitUpdate`, then the collection manager's default `toItem`
   maps it again for the delta — for `MessageService` that's two user
   fetches per posted message. Memoize per write cycle, or hand the
   already-computed DTO to `notifyCollections`.

6. **Rate limiter exclusions are exact-match footguns.**
   `excludeEvents: ["subscribe", "unsubscribe"]` (the pre-4.0 template
   config) matches nothing — real events are `{service}:subscribe`, and 4.0
   adds `{service}:collection:subscribe`/`:unsubscribe`. The template now
   builds the exclusion list from registered service names
   (`apps/api/src/index.ts`). Wanted: suffix/pattern support, or exempt
   framework subscription events by default (reconnect re-snapshot storms
   shouldn't eat the budget).

7. **`createTestServer` still can't express real auth.** No
   `auth`/`loadServiceAccess` passthrough, so apps whose tests depend on
   serviceAccess from the DB (SERVICE_DEFAULT_ACCESS merge, bootstrap
   admins) keep a private harness — this repo's `startTestServer` is
   `createQuickdrawServer` + the production hooks, which
   `createTestServer({ auth })` could absorb (RFC 0002 §3.6 adjacent).

8. **Minor:** each `createQuickdrawServer` instance registers its own
   SIGTERM/SIGINT handlers — parallel test servers in one process stack
   listeners (fine under vitest forks today, noisy beyond ~10 per process).

## Docs / RFC bookkeeping

9. RFC 0002 §4 cites `assertAllMethodsDefined()` at
   `.claude/rules/api-conventions.md:52` — that reference predates this
   repo's rules rewrite and the file no longer mentions it. The template's
   services now call the real `verifyAllMethods([...])` and the rules
   document it; the RFC line item can be closed.
