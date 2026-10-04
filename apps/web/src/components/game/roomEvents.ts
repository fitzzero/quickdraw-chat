/**
 * The game's 4.x room events, kept compiling until the game moves to
 * protocol v5 (the quickdraw 5.0 pack's game child): the server sends none of
 * them now, and 5.0's client has no `useRoomEvents` (contract events are
 * heard with `qd.<service>.<event>.useEvent`). The handler maps stay at their
 * call sites, each beside its review marker, for that port; this listens to
 * nothing.
 */
export function useRoomEvents(_handlers: Readonly<Record<string, (payload: never) => void>>): void {
  // Inert: see above
}
