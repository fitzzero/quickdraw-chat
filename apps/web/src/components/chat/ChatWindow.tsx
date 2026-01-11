"use client";

import * as React from "react";
import { Box, Typography, Paper, IconButton, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { useTranslations } from "next-intl";
import { useSubscription } from "../../hooks";
import { useSocket } from "../../providers";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { MessageDTO, ServiceResponse } from "@project/shared";

interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  const tCommon = useTranslations("Common");
  const { socket, isConnected, userId } = useSocket();
  const [messages, setMessages] = React.useState<MessageDTO[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = React.useState(true);

  // Subscribe to chat updates
  const { data: chat } = useSubscription("chatService", chatId);

  // Load messages on mount and when chatId changes
  React.useEffect(() => {
    if (!socket || !isConnected || !chatId) return;

    setIsLoadingMessages(true);
    socket.emit(
      "messageService:listMessages",
      { chatId, limit: 50 },
      (response: ServiceResponse<MessageDTO[]>) => {
        if (response.success) {
          setMessages(response.data);
        }
        setIsLoadingMessages(false);
      }
    );

    // Listen for new messages via the chat-scoped event
    // This event is emitted to the chatService room when any message is posted
    const handleNewMessage = (message: MessageDTO) => {
      // Only add if it's for this chat (should always be true due to room routing)
      if (message.chatId === chatId) {
        setMessages((prev) => {
          // Avoid duplicates (in case of reconnection or race conditions)
          if (prev.some((m) => m.id === message.id)) {
            return prev;
          }
          return [...prev, message];
        });
      }
    };

    // Subscribe to chat-scoped message events
    socket.on("chat:message", handleNewMessage);

    // TODO: Add listener for message deletions/edits when implemented
    // This would be something like: socket.on("chat:messageUpdate", handleMessageUpdate)

    return () => {
      socket.off("chat:message", handleNewMessage);
    };
  }, [socket, isConnected, chatId]);

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
      {/* Chat Header */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6">
          {chat?.title ?? tCommon("loading")}
        </Typography>
        <Tooltip title={t("chatSettings")}>
          <IconButton size="small">
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isLoadingMessages}
        currentUserId={userId}
      />

      {/* Input */}
      <MessageInput
        chatId={chatId}
        onMessageSent={handleMessageSent}
        disabled={!isConnected}
      />
    </Box>
  );
}
