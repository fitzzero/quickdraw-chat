import type { ChatMemberDTO } from "./chat.js";

// ============================================================================
// Custom Room Events (typed via core's augmentable QuickdrawEventMap)
// ============================================================================
// Every custom event emitted with `emitToRoom` and consumed with
// `useRoomEvents` / `invalidateOn` is declared here — raw string event names
// with hand-typed payloads at call sites are the legacy pattern. Collection
// deltas and `{service}:update:{id}` events do NOT belong here; the framework
// generates and types those end-to-end.

// quickdraw-migrate: review [v4-api] QuickdrawEventMap typed 4.x room events: declare each event in its contract (events: { name: { payload } }), send it with ctx.rooms.emit and listen with qd.<service>.<event>.useEvent, then delete this augmentation
declare module "@fitzzero/quickdraw-core" {
  interface QuickdrawEventMap {
    /** Membership roster changed — emitted to the chat's entity room. */
    "chat:memberUpdate": { members: ChatMemberDTO[] };
  }
}
