"use client";

import * as React from "react";
import { useSocket } from "../providers";
import type { ChatListItem, ServiceResponse } from "@project/shared";

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
  const { socket, isConnected, userId } = useSocket();
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchChats = React.useCallback(() => {
    if (!socket || !isConnected || !userId) {
      setChats([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    socket.emit(
      "chatService:listMyChats",
      { pageSize: limit },
      (response: ServiceResponse<ChatListItem[]>) => {
        if (response.success) {
          setChats(response.data);
        } else {
          setError(response.error);
        }
        setIsLoading(false);
      }
    );
  }, [socket, isConnected, userId, limit]);

  // Fetch on mount and when connection/user changes
  React.useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  return {
    chats,
    isLoading,
    error,
    refetch: fetchChats,
  };
}
