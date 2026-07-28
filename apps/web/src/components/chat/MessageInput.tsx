"use client";

import * as React from "react";
import { Box, TextField, IconButton, CircularProgress } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useTranslations } from "next-intl";
import { useService } from "../../hooks";

interface MessageInputProps {
  chatId: string;
  disabled?: boolean;
}

export function MessageInput({ chatId, disabled }: MessageInputProps): React.ReactElement {
  const t = useTranslations("MessageInput");
  const [message, setMessage] = React.useState("");

  // No follow-up work on success: the byChat collection delivers the posted
  // message to every subscriber (this window included)
  const postMessage = useService("messageService", "postMessage", {
    onSuccess: () => {
      setMessage("");
    },
  });

  const handleSend = () => {
    if (message.trim() && !postMessage.isPending) {
      postMessage.mutate({
        chatId,
        content: message.trim(),
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: "divider",
        display: "flex",
        gap: 1,
        alignItems: "flex-end",
      }}
    >
      <TextField
        fullWidth
        multiline
        maxRows={4}
        placeholder={t("placeholder")}
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled ?? postMessage.isPending}
        size="small"
      />
      <IconButton
        color="primary"
        onClick={handleSend}
        disabled={!message.trim() || postMessage.isPending || disabled}
      >
        {postMessage.isPending ? <CircularProgress size={24} /> : <SendIcon />}
      </IconButton>
    </Box>
  );
}
