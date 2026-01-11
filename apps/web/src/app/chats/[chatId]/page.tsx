"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Box } from "@mui/material";
import { ChatWindow, ChatSidebar } from "../../../components/chat";
import { usePageTitle, useRightSidebar } from "../../../providers";
import { useSubscription } from "../../../hooks";
import { NotFound, NoPermission } from "../../../components/feedback";

export default function ChatPage(): React.ReactElement {
  const params = useParams();
  const chatId = params.chatId as string;

  // Subscribe to chat data
  const { data: chat, error } = useSubscription("chatService", chatId);

  // Set page title from chat data
  usePageTitle(chat?.title ?? null);

  // Set right sidebar content
  const sidebarContent = React.useMemo(
    () => <ChatSidebar chatId={chatId} />,
    [chatId]
  );
  useRightSidebar(sidebarContent);

  // Handle error states
  if (error) {
    // Check if it's a permission error
    if (
      error.includes("403") ||
      error.toLowerCase().includes("permission") ||
      error.toLowerCase().includes("access")
    ) {
      return <NoPermission message="You don't have access to this chat" />;
    }
    return (
      <NotFound
        message="Chat not found"
        backHref="/chats"
        backLabel="Back to Chats"
      />
    );
  }

  // Loading state handled by ChatWindow
  return (
    <Box
      sx={{
        height: "calc(100vh - 128px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ChatWindow chatId={chatId} />
    </Box>
  );
}
