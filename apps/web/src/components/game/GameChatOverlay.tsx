"use client";

import * as React from "react";
import { Badge, Box, Fab, IconButton, Paper, Typography } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import CloseIcon from "@mui/icons-material/ExpandMore";
import { useTranslations } from "next-intl";
import { qd } from "../../lib/quickdraw";
import { ChatWindow } from "../chat";

interface GameChatOverlayProps {
  /** The world's chat (from gameService.getWorld). */
  chatId: string;
}

/**
 * The game-server chat: the existing chat service rendered as a
 * minimizable DOM overlay in the bottom-right of the game.
 *
 * Membership in this chat is granted server-side by gameService.watchWorld
 * (Godot's spectate boot) and joinGame, so this overlay mounts as soon as
 * the engine reports ready — spectators can chat from behind the pre-game
 * dialog. ChatWindow is reused as-is — this wrapper adds the unread badge
 * and expand/minimize with canvas focus handoff.
 */
export function GameChatOverlay({ chatId }: GameChatOverlayProps): React.ReactElement {
  const t = useTranslations("GameChat");
  const [open, setOpen] = React.useState(false);

  // The chat's live history, held from mount (ChatWindow shows the same
  // scope), so its count moves while the panel is minimized: what arrived
  // since the panel was last open is unread
  const { totalCount } = qd.messageService.byChat.useCollection(chatId);
  const [seenCount, setSeenCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (totalCount !== null && (open || seenCount === null)) setSeenCount(totalCount);
  }, [open, totalCount, seenCount]);
  const unread =
    open || totalCount === null || seenCount === null ? 0 : Math.max(0, totalCount - seenCount);

  const handleOpen = (): void => {
    setOpen(true);
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
