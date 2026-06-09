"use client";

import * as React from "react";
import { useSocket } from "../providers";
import { useServiceQuery } from "./useServiceQuery";
import type { ChatListItem } from "@project/shared";

interface UseRecentChatsResult {
  chats: ChatListItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch the most recent chats for sidebar navigation.
 * Returns up to `limit` chats (default 3).
 */
export function useRecentChats(limit = 3): UseRecentChatsResult {
  const { isConnected, userId } = useSocket();
  const enabled = isConnected && !!userId;

  const payload = React.useMemo(() => ({ pageSize: limit }), [limit]);
  const { data, isFetching, error, refetch } = useServiceQuery(
    "chatService",
    "listMyChats",
    payload,
    {
      enabled,
      // Always fetch fresh chats when (re)mounting the sidebar
      staleTime: 0,
    },
  );

  const refetchChats = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    chats: enabled ? (data ?? []) : [],
    isLoading: isFetching,
    error,
    refetch: refetchChats,
  };
}
