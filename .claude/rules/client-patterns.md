---
paths:
  - "apps/web/**/*"
---

# Client Patterns

```typescript
// Data fetching (typed wrappers in src/hooks/, over @fitzzero/quickdraw-core/client)
useCollection("messageService", "byChat", chatId, { compare }) // live lists (THE default)
useSubscription("entityService", entityId)                     // real-time single entity
useServiceQuery("entityService", "getEntity", { id })          // one-shot reads
useService("entityService", "updateEntity")                    // mutation

// Query-shaped reads that must react to a room event
useServiceQuery("chatService", "getChatMembers", { chatId }, {
  invalidateOn: ["chat:memberUpdate"],
});

// Socket-synced inputs (from @fitzzero/quickdraw-core/client)
<SocketTextField ... />
<SocketCheckbox ... />
```

## Live lists: `useCollection` is the default

Any list of rows that should update in real time is a server-declared
collection (`defineCollection`) consumed with `useCollection` — items, byId,
totalCount, `loadMore` pagination, live `added`/`updated`/`removed` merge,
reconnect re-snapshot, and offline-deletion pruning all come from the
framework:

```tsx
const { items, isLoading, hasMore, isLoadingMore, loadMore } = useCollection<MessageDTO>(
  "messageService",
  "byChat",
  chatId,
  { compare: compareByCreatedAt }, // module-scope comparator (referential stability)
);
```

Project examples: `useMyChats()` (wraps the user-scoped `myChats`
collection; shared by the sidebar and /chats page) and `ChatWindow`
(`byChat` with `loadMore` history paging).

**Legacy patterns — do NOT reintroduce for row lists:** `staleTime: 0`
refetching, `onRefresh` callback props, `useRoomEvents` mirror handlers with
`useState` merge/dedupe, and `invalidateOn` as a list-refresh mechanism.

## Socket Data Hooks — NEVER Use Raw `socket.on` or `socket.emit`

All service communication MUST go through the typed hooks (lint-enforced:
`quickdraw/no-raw-socket-on` / `no-raw-socket-emit`). Raw calls bypass type
safety, miss caching/deduplication, and leak subscriptions.

| Operation             | Hook                                        | Example                                                         |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Live row lists        | `useCollection(service, name, scopeId)`     | `useCollection("chatService", "myChats", userId)`               |
| Real-time entity data | `useSubscription(service, id)`              | `useSubscription("chatService", chatId)`                        |
| One-shot reads        | `useServiceQuery(service, method, payload)` | `useServiceQuery("userService", "getMe", {})`                   |
| Mutations             | `useService(service, method, opts?)`        | `useService("chatService", "createChat")`                       |
| Custom room events    | `useRoomEvents({ event: handler })`         | `useRoomEvents({ "presence:changed": (p) => ... })`             |
| Query + room event    | `useServiceQuery(..., { invalidateOn })`    | `useServiceQuery(..., { invalidateOn: ["chat:memberUpdate"] })` |

- Custom events are typed via the `QuickdrawEventMap` augmentation in
  `packages/shared/src/types/events.ts` — add new events there, never
  hand-type payloads at call sites. Collection deltas and entity updates are
  framework events; they never appear in the map.
- `invalidateOn` is for genuinely query-shaped reads (joins/aggregates like
  the member roster), not row lists.
- `useRoomEvents` manages listener attach/detach + reconnect, but room
  membership comes from `useSubscription` — keep both when consuming room
  broadcasts.
- Reconnects: the provider invalidates all TanStack queries by default
  (`reconnectBehavior="invalidate-queries"`), and collections re-snapshot
  themselves — no hand-rolled resync effects.

## UI Text & Styling

- **No raw strings** in `Typography`, `Button`, or `Tooltip` (lint-enforced) —
  use `useTranslations()` from next-intl with keys in `apps/web/src/messages/en.json`
- Use MUI `sx` props with theme tokens (`"text.primary"`, `"grey.800"`), not raw hex
- Theme lives at `apps/web/src/theme/index.ts`
