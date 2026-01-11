"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Box, Typography, List, ListItem, ListItemText, Skeleton, Avatar } from "@mui/material";
import { ChatWindow } from "../../../components/chat";
import { usePageTitle, useRightSidebar, useSocket } from "../../../providers";
import { useSubscription } from "../../../hooks";
import { NotFound, NoPermission } from "../../../components/feedback";

interface ChatMember {
  id: string;
  level: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

function ChatMembersList({ chatId }: { chatId: string }): React.ReactElement {
  const { socket, isConnected } = useSocket();
  const [members] = React.useState<ChatMember[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  // Fetch members
  React.useEffect(() => {
    if (!socket || !isConnected || !chatId) return;

    // Note: This assumes a getChatMembers method exists or we use subscription
    // For now, we'll just show a placeholder
    setIsLoading(false);
    // TODO: Implement actual member fetching when the service method is available
  }, [socket, isConnected, chatId]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Members
      </Typography>
      {isLoading ? (
        <List dense>
          {[1, 2, 3].map((i) => (
            <ListItem key={i}>
              <Skeleton variant="circular" width={32} height={32} sx={{ mr: 2 }} />
              <ListItemText primary={<Skeleton variant="text" width="60%" />} />
            </ListItem>
          ))}
        </List>
      ) : members.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Member list coming soon...
        </Typography>
      ) : (
        <List dense disablePadding>
          {members.map((member) => (
            <ListItem key={member.id}>
              <Avatar
                src={member.user.image ?? undefined}
                sx={{ width: 32, height: 32, bgcolor: "primary.main" }}
              >
                {member.user.name?.[0]?.toUpperCase() ?? "U"}
              </Avatar>
              <ListItemText
                primary={member.user.name ?? "Unknown"}
                secondary={member.level}
                sx={{ ml: 2 }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}

export default function ChatPage(): React.ReactElement {
  const params = useParams();
  const chatId = params.chatId as string;

  // Subscribe to chat data
  const { data: chat, error } = useSubscription("chatService", chatId);

  // Set page title from chat data
  usePageTitle(chat?.title ?? null);

  // Set right sidebar content
  const sidebarContent = React.useMemo(
    () => <ChatMembersList chatId={chatId} />,
    [chatId]
  );
  useRightSidebar(sidebarContent);

  // Handle error states
  if (error) {
    // Check if it's a permission error
    if (error.includes("403") || error.toLowerCase().includes("permission") || error.toLowerCase().includes("access")) {
      return <NoPermission message="You don't have access to this chat" />;
    }
    return <NotFound message="Chat not found" backHref="/chats" backLabel="Back to Chats" />;
  }

  // Loading state handled by ChatWindow
  return (
    <Box sx={{ height: "calc(100vh - 128px)", display: "flex", flexDirection: "column" }}>
      <ChatWindow chatId={chatId} />
    </Box>
  );
}
