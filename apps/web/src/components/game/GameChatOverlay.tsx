"use client";

import * as React from "react";
import { Badge, Box, Fab, IconButton, Paper, Typography } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import CloseIcon from "@mui/icons-material/ExpandMore";
import { useTranslations } from "next-intl";
import type { MessageDTO } from "@project/shared";
import { useRoomEvents, useSubscription } from "../../hooks";
import { ChatWindow } from "../chat";

interface GameChatOverlayProps {
  /** The world's chat (from gameService.getWorld). */
  chatId: string;
}

/**
 * The game-server chat: the existing chat service rendered as a
 * minimizable DOM overlay in the bottom-right of the game.
 *
 * Membership in this chat is granted server-side by gameService.joinGame,
 * so this overlay only mounts once the game reports ready. ChatWindow is
 * reused as-is — this wrapper adds room membership (useSubscription), the
 * unread badge, and expand/minimize with canvas focus handoff.
 */
export function GameChatOverlay({ chatId }: GameChatOverlayProps): React.ReactElement {
  const t = useTranslations("GameChat");
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);

  // Join the chat room immediately (membership exists once the game joined),
  // so unread counts accrue even while the panel is minimized.
  useSubscription("chatService", chatId);

  useRoomEvents({
    "chat:message": (message: MessageDTO) => {
      if (message.chatId === chatId && !open) {
        setUnread((count) => count + 1);
      }
    },
  });

  const handleOpen = (): void => {
    setOpen(true);
    setUnread(0);
  };

  const handleMinimize = (): void => {
    setOpen(false);
    // Hand keyboard focus back to the game
    document.getElementById("godot-canvas")?.focus();
  };

  if (!open) {
    return (
      <Fab
        color="primary"
        size="medium"
        onClick={handleOpen}
        aria-label={t("open")}
        sx={{ position: "absolute", bottom: 24, right: 24 }}
      >
        <Badge badgeContent={unread} color="error" max={99}>
          <ChatIcon />
        </Badge>
      </Fab>
    );
  }

  return (
    <Paper
      elevation={8}
      sx={{
        position: "absolute",
        bottom: 24,
        right: 24,
        width: 360,
        height: 480,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "rgba(20, 23, 30, 0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="subtitle2">{t("title")}</Typography>
        <IconButton size="small" onClick={handleMinimize} aria-label={t("minimize")}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ChatWindow chatId={chatId} />
      </Box>
    </Paper>
  );
}
