import type { ChatMemberDTO } from "./chat.js";

// ============================================================================
// Custom Room Events (typed via core's augmentable QuickdrawEventMap)
// ============================================================================
// Every custom event emitted with `emitToRoom` and consumed with
// `useRoomEvents` / `invalidateOn` is declared here — raw string event names
// with hand-typed payloads at call sites are the legacy pattern. Collection
// deltas and `{service}:update:{id}` events do NOT belong here; the framework
// generates and types those end-to-end.

declare module "@fitzzero/quickdraw-core" {
  interface QuickdrawEventMap {
    /** Membership roster changed — emitted to the chat's entity room. */
    "chat:memberUpdate": { members: ChatMemberDTO[] };
  }
}
