"use client";

import * as React from "react";
import {
  Box,
  Typography,
  Avatar,
  Paper,
  CircularProgress,
} from "@mui/material";
import { useTranslations } from "next-intl";
import type { MessageDTO } from "@project/shared";

interface MessageListProps {
  messages: MessageDTO[];
  isLoading: boolean;
  currentUserId?: string | null;
}

export function MessageList({
  messages,
  isLoading,
  currentUserId,
}: MessageListProps): React.ReactElement {
  const t = useTranslations("MessageList");
  const tCommon = useTranslations("Common");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
    <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
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
      <div ref={messagesEndRef} />
    </Box>
  );
}
