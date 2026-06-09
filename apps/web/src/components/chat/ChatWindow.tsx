"use client";

import * as React from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useRoomEvents, useServiceQuery } from "../../hooks";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { MessageDTO } from "@project/shared";

interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  const { isConnected, userId } = useSocket();
  const [messages, setMessages] = React.useState<MessageDTO[]>([]);

  // Load messages on mount and when chatId changes
  const listPayload = React.useMemo(() => ({ chatId, limit: 50 }), [chatId]);
  const { data: loadedMessages, isError } = useServiceQuery(
    "messageService",
    "listMessages",
    listPayload,
    {
      enabled: !!chatId,
      // Always fetch fresh messages when opening a chat
      staleTime: 0,
    },
  );

  // Sync fetched history into local state (new messages are appended below)
  React.useEffect(() => {
    if (loadedMessages) {
      setMessages(loadedMessages);
    }
  }, [loadedMessages]);

  const isLoadingMessages = loadedMessages === undefined && !isError;

  // Listen for new messages via the chat-scoped event.
  // This event is emitted to the chatService room when any message is posted.
  // Room membership is managed by the page's useSubscription; useRoomEvents
  // only attaches/detaches the listener (including across reconnects).
  //
  // Note: Message deletions/edits are handled via the subscription system.
  // When a message is deleted, the messageService emits an update with
  // { deleted: true } which is received by subscribers. For future edit
  // support, add a 'chat:messageUpdate' handler here.
  useRoomEvents({
    "chat:message": (message: MessageDTO) => {
      // Only add if it's for this chat (should always be true due to room routing)
      if (message.chatId !== chatId) return;
      setMessages((prev) => {
        // Avoid duplicates (in case of reconnection or race conditions)
        if (prev.some((m) => m.id === message.id)) {
          return prev;
        }
        return [...prev, message];
      });
    },
  });

  // No need to refresh after sending - real-time updates handle it
  const handleMessageSent = React.useCallback(() => {
    // The message will appear via the chat:message event
    // No manual refresh needed
  }, []);

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
      <MessageList messages={messages} isLoading={isLoadingMessages} currentUserId={userId} />

      {/* Input */}
      <MessageInput chatId={chatId} onMessageSent={handleMessageSent} disabled={!isConnected} />
    </Box>
  );
}
