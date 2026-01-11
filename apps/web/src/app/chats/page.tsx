"use client";

import * as React from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Skeleton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSocket } from "../../providers";
import { useService } from "../../hooks";
import type { ChatListItem, ServiceResponse } from "@project/shared";

export default function ChatsPage(): React.ReactElement {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [newChatTitle, setNewChatTitle] = React.useState("");

  // Fetch all chats
  const fetchChats = React.useCallback(() => {
    if (!socket || !isConnected) return;

    setIsLoading(true);
    socket.emit(
      "chatService:listMyChats",
      { pageSize: 50 },
      (response: ServiceResponse<ChatListItem[]>) => {
        if (response.success) {
          setChats(response.data);
        }
        setIsLoading(false);
      }
    );
  }, [socket, isConnected]);

  React.useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  // Create chat mutation
  const createChat = useService("chatService", "createChat", {
    onSuccess: (data) => {
      setCreateDialogOpen(false);
      setNewChatTitle("");
      router.push(`/chats/${data.id}`);
    },
  });

  const handleCreateChat = () => {
    if (newChatTitle.trim()) {
      createChat.mutate({ title: newChatTitle.trim() });
    }
  };

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Your Chats
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={(): void => {
            setCreateDialogOpen(true);
          }}
        >
          New Chat
        </Button>
      </Box>

      {/* Chat List */}
      <Paper>
        {isLoading ? (
          <List>
            {[1, 2, 3].map((i) => (
              <ListItem key={i} divider>
                <ListItemText
                  primary={<Skeleton variant="text" width="60%" />}
                  secondary={<Skeleton variant="text" width="30%" />}
                />
              </ListItem>
            ))}
          </List>
        ) : chats.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              You don&apos;t have any chats yet.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={(): void => {
                setCreateDialogOpen(true);
              }}
            >
              Create Your First Chat
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {chats.map((chat, index) => (
              <ListItem
                key={chat.id}
                disablePadding
                divider={index < chats.length - 1}
              >
                <ListItemButton component={Link} href={`/chats/${chat.id}`}>
                  <ListItemText
                    primary={chat.title}
                    secondary={`${chat.memberCount} member${chat.memberCount !== 1 ? "s" : ""}${
                      chat.lastMessageAt
                        ? ` · Last message ${new Date(chat.lastMessageAt).toLocaleDateString()}`
                        : ""
                    }`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      {/* Create Chat Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={(): void => {
          setCreateDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create New Chat</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Chat Title"
            fullWidth
            variant="outlined"
            value={newChatTitle}
            onChange={(e): void => {
              setNewChatTitle(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateChat();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={(): void => {
              setCreateDialogOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateChat}
            variant="contained"
            disabled={!newChatTitle.trim() || createChat.isPending}
          >
            {createChat.isPending ? <CircularProgress size={20} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
