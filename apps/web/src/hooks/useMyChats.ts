"use client";

import { useCollection, type UseCollectionResult } from "@fitzzero/quickdraw-core/client";
import { useSocket } from "../providers";
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
  return useCollection<ChatListItem>("chatService", "myChats", userId ?? null, {
    compare: compareByActivity,
  });
}
