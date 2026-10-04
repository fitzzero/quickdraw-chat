"use client";

import * as React from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { UseCollectionResult } from "@fitzzero/quickdraw-core/client";
import { qd } from "../../lib/quickdraw";
import type { MessageDTO } from "@project/shared";

export interface ChatWindowProps {
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
  // quickdraw-migrate: review [client] declare the collection "byChat" in the messageService contract (see the [collection] marker where 4.x defined it): qd.messageService.byChat does not exist until then, and the cast to the 4.x item type stands in for its type; delete the cast once it is declared
  // quickdraw-migrate: review [client] compare is gone: items follow the contract collection's order (put the sort there)
  const {
    items: messages,
    isLoading,
    hasMore,
    isLoadingMore,
    loadMore,
  } = qd.messageService.byChat.useCollection(chatId || null, {
    compare: compareByCreatedAt,
  }) as UseCollectionResult<MessageDTO, { readonly id: string }>;

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
