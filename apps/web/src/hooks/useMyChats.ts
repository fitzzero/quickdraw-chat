"use client";

import { type UseCollectionResult } from "@fitzzero/quickdraw-core/client";
import { useSocket } from "../providers";
import { qd } from "../lib/quickdraw";
import type { ChatListItem } from "@project/shared";

// Most recent activity first; chats without messages fall back to creation
// time. Referentially stable (module scope) so the hook never re-sorts on
// unrelated renders.
function compareByActivity(a: ChatListItem, b: ChatListItem): number {
  const aTime = a.lastMessageAt ?? a.createdAt;
  const bTime = b.lastMessageAt ?? b.createdAt;
  return bTime.localeCompare(aTime) || a.id.localeCompare(b.id);
}

/**
 * The user's live chat list — the `myChats` collection scoped by the
 * signed-in user's id.
 *
 * One subscription serves every component on the page (sidebar nav and the
 * /chats index share it): the server pushes `added`/`updated`/`removed`
 * deltas as chats are created, renamed, joined, left, or get new messages —
 * no refetching, no `staleTime: 0`, no manual onRefresh wiring. Reconnects
 * re-snapshot automatically and prune chats deleted while offline.
 */
export function useMyChats(): UseCollectionResult<ChatListItem> {
  const { userId } = useSocket();
  // quickdraw-migrate: review [client] declare the collection "myChats" in the chatService contract (see the [collection] marker where 4.x defined it): qd.chatService.myChats does not exist until then, and the cast to the 4.x item type stands in for its type; delete the cast once it is declared
  // quickdraw-migrate: review [client] compare is gone: items follow the contract collection's order (put the sort there)
  return qd.chatService.myChats.useCollection(userId ?? null, {
    compare: compareByActivity,
  }) as UseCollectionResult<ChatListItem, { readonly id: string }>;
}
