"use client";

import * as React from "react";
import { Box, Typography, Paper, IconButton, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { useSubscription } from "../../hooks";
import { useSocket } from "../../providers";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { MessageDTO, ServiceResponse } from "@project/shared";

interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
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

    // Listen for new messages
    const handleNewMessage = (message: MessageDTO) => {
      if (message.chatId === chatId) {
        setMessages((prev) => [...prev, message]);
      }
    };

    // Subscribe to message updates for this chat
    const messageUpdateEvent = `messageService:update:*`;
    socket.on(messageUpdateEvent, handleNewMessage);

    return () => {
      socket.off(messageUpdateEvent, handleNewMessage);
    };
  }, [socket, isConnected, chatId]);

  const handleMessageSent = React.useCallback(() => {
    // Refresh messages after sending
    if (socket && isConnected) {
      socket.emit(
        "messageService:listMessages",
        { chatId, limit: 50 },
        (response: ServiceResponse<MessageDTO[]>) => {
          if (response.success) {
            setMessages(response.data);
          }
        }
      );
    }
  }, [socket, isConnected, chatId]);

  if (!chatId) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
        <Typography color="text.secondary">Select a chat to start messaging</Typography>
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
        <Typography variant="h6">{chat?.title ?? "Loading..."}</Typography>
        <Tooltip title="Chat Settings">
          <IconButton size="small">
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {/* Messages */}
      <MessageList messages={messages} isLoading={isLoadingMessages} currentUserId={userId} />

      {/* Input */}
      <MessageInput chatId={chatId} onMessageSent={handleMessageSent} disabled={!isConnected} />
    </Box>
  );
}
