"use client";

import * as React from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useCollection } from "../../hooks";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { MessageDTO } from "@project/shared";

interface ChatWindowProps {
  chatId: string;
}

// Chronological order; ids tie-break equal timestamps deterministically.
// Module scope keeps the comparator referentially stable across renders.
function compareByCreatedAt(a: MessageDTO, b: MessageDTO): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  const { isConnected, userId } = useSocket();

  // The chat's live message history: one hook replaces the old
  // useServiceQuery(listMessages) + useRoomEvents("chat:message") +
  // useState merge/dedupe stack. The snapshot pages newest-first;
  // `compare` renders chronologically; `loadMore` walks into history via
  // the same subscribe event with a cursor; live added/removed deltas and
  // reconnect re-snapshots are handled by the framework.
  const {
    items: messages,
    isLoading,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useCollection<MessageDTO>("messageService", "byChat", chatId || null, {
    compare: compareByCreatedAt,
  });

  const handleLoadOlder = React.useCallback(() => {
    void loadMore();
  }, [loadMore]);

  if (!chatId) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">{t("selectChat")}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        currentUserId={userId}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadOlder={handleLoadOlder}
      />

      {/* Input */}
      <MessageInput chatId={chatId} disabled={!isConnected} />
    </Box>
  );
}
