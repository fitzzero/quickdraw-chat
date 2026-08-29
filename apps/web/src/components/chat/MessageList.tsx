"use client";

import * as React from "react";
import { Box, Button, Typography, Avatar, Paper, CircularProgress } from "@mui/material";
import { useTranslations } from "next-intl";
import type { MessageDTO } from "@project/shared";

interface MessageListProps {
  messages: MessageDTO[];
  isLoading: boolean;
  currentUserId?: string | null;
  /** Older history exists beyond the loaded window */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadOlder?: () => void;
}

export function MessageList({
  messages,
  isLoading,
  currentUserId,
  hasMore = false,
  isLoadingMore = false,
  onLoadOlder,
}: MessageListProps): React.ReactElement {
  const t = useTranslations("MessageList");
  const tCommon = useTranslations("Common");
  const listRef = React.useRef<HTMLDivElement>(null);

  // Scroll the list container directly — scrollIntoView would also scroll
  // every scrollable ancestor, which shifts the page behind an overlaid
  // chat. Follow the conversation only when the *newest* message changes —
  // paging older history in at the top must not yank the scroll down.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
  React.useEffect(() => {
    const list = listRef.current;
    if (list && lastMessageId) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [lastMessageId]);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (messages.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">{t("noMessages")}</Typography>
      </Box>
    );
  }

  return (
    <Box ref={listRef} sx={{ flex: 1, overflow: "auto", p: 2 }}>
      {hasMore && (
        <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
          <Button size="small" variant="outlined" onClick={onLoadOlder} disabled={isLoadingMore}>
            {isLoadingMore ? <CircularProgress size={18} /> : t("loadOlder")}
          </Button>
        </Box>
      )}
      {messages.map((message) => {
        const isOwnMessage = message.userId === currentUserId;

        return (
          <Box
            key={message.id}
            sx={{
              display: "flex",
              justifyContent: isOwnMessage ? "flex-end" : "flex-start",
              mb: 2,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: isOwnMessage ? "row-reverse" : "row",
                alignItems: "flex-start",
                maxWidth: "70%",
              }}
            >
              <Avatar
                src={message.user?.image ?? undefined}
                sx={{
                  width: 32,
                  height: 32,
                  mx: 1,
                  bgcolor: isOwnMessage ? "primary.main" : "secondary.main",
                }}
              >
                {message.user?.name?.[0] ?? "U"}
              </Avatar>
              <Paper
                elevation={1}
                sx={{
                  p: 1.5,
                  bgcolor: isOwnMessage ? "primary.dark" : "background.paper",
                  borderRadius: 2,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mb: 0.5 }}
                >
                  {message.user?.name ?? tCommon("unknownUser")}
                </Typography>
                <Typography variant="body2">{message.content}</Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {new Date(message.createdAt).toLocaleTimeString()}
                </Typography>
              </Paper>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
