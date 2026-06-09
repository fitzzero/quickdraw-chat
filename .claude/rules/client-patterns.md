---
paths:
  - "apps/web/**/*"
---

# Client Patterns

```typescript
// Data fetching (from @fitzzero/quickdraw-core/client)
useServiceQuery("entityService", "getEntity", { id })   // read
useService("entityService", "updateEntity")              // mutation
useSubscription("entityService", entityId)               // real-time updates

// Custom room events
useRoomEvents({
  "chat:message": (msg) => appendMessage(msg),
});

// Auto-invalidating queries
useServiceQuery("chatService", "listMyChats", {}, {
  invalidateOn: ["chat:memberUpdate"],
});

// Socket-synced inputs (from @fitzzero/quickdraw-core/client)
<SocketTextField ... />
<SocketCheckbox ... />
```

## Socket Data Hooks — NEVER Use Raw `socket.on` or `socket.emit`

All service communication MUST go through the typed hooks (lint-enforced:
`quickdraw/no-raw-socket-on` / `no-raw-socket-emit`). Raw calls bypass type
safety, miss caching/deduplication, and leak subscriptions.

| Operation             | Hook                                        | Example                                                         |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Real-time entity data | `useSubscription(service, id)`              | `useSubscription("chatService", chatId)`                        |
| One-shot reads        | `useServiceQuery(service, method, payload)` | `useServiceQuery("chatService", "listMyChats", {})`              |
| Mutations             | `useService(service, method, opts?)`        | `useService("chatService", "createChat")`                        |
| Custom room events    | `useRoomEvents({ event: handler })`         | `useRoomEvents({ "chat:message": (msg) => append(msg) })`        |
| Auto-refetch on event | `useServiceQuery(..., { invalidateOn })`    | `useServiceQuery(..., { invalidateOn: ["chat:memberUpdate"] })`  |

`useRoomEvents` manages listener attach/detach + reconnect, but room
membership comes from `useSubscription` — keep both when consuming room
broadcasts.

## UI Text & Styling

- **No raw strings** in `Typography`, `Button`, or `Tooltip` (lint-enforced) —
  use `useTranslations()` from next-intl with keys in `apps/web/src/messages/en.json`
- Use MUI `sx` props with theme tokens (`"text.primary"`, `"grey.800"`), not raw hex
- Theme lives at `apps/web/src/theme/index.ts`
