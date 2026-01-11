"use client";

import * as React from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslations } from "next-intl";
import { useService } from "../../hooks";
import type { ChatListItem } from "@project/shared";

interface ChatListProps {
  chats: ChatListItem[];
  isLoading: boolean;
  selectedChatId?: string;
  onSelectChat: (chatId: string) => void;
  onRefresh: () => void;
}

export function ChatList({
  chats,
  isLoading,
  selectedChatId,
  onSelectChat,
  onRefresh,
}: ChatListProps): React.ReactElement {
  const t = useTranslations("ChatList");
  const tCommon = useTranslations("Common");
  const tChatWindow = useTranslations("ChatWindow");
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [newChatTitle, setNewChatTitle] = React.useState("");

  const createChat = useService("chatService", "createChat", {
    onSuccess: (data) => {
      setCreateDialogOpen(false);
      setNewChatTitle("");
      onRefresh();
      onSelectChat(data.id);
    },
  });

  const handleCreateChat = () => {
    if (newChatTitle.trim()) {
      createChat.mutate({ title: newChatTitle.trim() });
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("title")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setCreateDialogOpen(true);
          }}
          fullWidth
          size="small"
        >
          {t("newChat")}
        </Button>
      </Box>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <List sx={{ flex: 1, overflow: "auto" }}>
          {chats.length === 0 ? (
            <ListItem>
              <ListItemText
                secondary={t("noChats")}
                sx={{ textAlign: "center" }}
              />
            </ListItem>
          ) : (
            chats.map((chat) => (
              <ListItem key={chat.id} disablePadding>
                <ListItemButton
                  selected={chat.id === selectedChatId}
                  onClick={() => {
                    onSelectChat(chat.id);
                  }}
                >
                  <ListItemText
                    primary={chat.title}
                    secondary={t("memberCount", { count: chat.memberCount })}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      )}

      <Dialog
        open={createDialogOpen}
        onClose={() => {
          setCreateDialogOpen(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{tChatWindow("createDialogTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label={tChatWindow("chatTitleLabel")}
            fullWidth
            variant="outlined"
            value={newChatTitle}
            onChange={(e) => {
              setNewChatTitle(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateChat();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreateDialogOpen(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleCreateChat}
            variant="contained"
            disabled={!newChatTitle.trim() || createChat.isPending}
          >
            {createChat.isPending ? (
              <CircularProgress size={20} />
            ) : (
              tCommon("create")
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
