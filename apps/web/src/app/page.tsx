"use client";

import * as React from "react";
import { Box, Paper, Typography, CircularProgress, Alert } from "@mui/material";
import { ChatList, ChatWindow } from "../components/chat";
import { useSocket } from "../providers";
import { useService } from "../hooks";
import type { ChatListItem, ServiceResponse } from "@project/shared";

export default function HomePage(): React.ReactElement {
  const { socket, isConnected, userId } = useSocket();
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(null);
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [isLoadingChats, setIsLoadingChats] = React.useState(true);

  // Load chats
  const loadChats = React.useCallback(() => {
    if (!socket || !isConnected) return;

    setIsLoadingChats(true);
    socket.emit("chatService:listMyChats", {}, (response: ServiceResponse<ChatListItem[]>) => {
      if (response.success) {
        setChats(response.data);
      }
      setIsLoadingChats(false);
    });
  }, [socket, isConnected]);

  React.useEffect(() => {
    loadChats();
  }, [loadChats]);

  if (!isConnected) {
    return (
      <Box
        sx={{
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary">Connecting to server...</Typography>
      </Box>
    );
  }

  if (!userId) {
    return (
      <Box
        sx={{
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 3,
          p: 4,
        }}
      >
        <Typography variant="h4" component="h1">
          Welcome to Chat App
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 400, textAlign: "center" }}>
          Sign in to start chatting with others in real-time.
        </Typography>
        <Box
          component="a"
          href="/auth/login"
          sx={{
            bgcolor: "primary.main",
            color: "white",
            px: 4,
            py: 1.5,
            borderRadius: 2,
            textDecoration: "none",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          Sign In
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100vh", display: "flex" }}>
      {/* Sidebar */}
      <Paper
        elevation={0}
        sx={{
          width: 280,
          borderRight: 1,
          borderColor: "divider",
          height: "100%",
        }}
      >
        <ChatList
          chats={chats}
          isLoading={isLoadingChats}
          selectedChatId={selectedChatId ?? undefined}
          onSelectChat={setSelectedChatId}
          onRefresh={loadChats}
        />
      </Paper>

      {/* Main Content */}
      <Box sx={{ flex: 1, height: "100%" }}>
        {selectedChatId ? (
          <ChatWindow chatId={selectedChatId} />
        ) : (
          <Box
            sx={{
              height: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Typography color="text.secondary">Select a chat or create a new one</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
