"use client";

import * as React from "react";
import { Box, TextField, IconButton, CircularProgress } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useService } from "../../hooks";

interface MessageInputProps {
  chatId: string;
  onMessageSent?: () => void;
  disabled?: boolean;
}

export function MessageInput({ chatId, onMessageSent, disabled }: MessageInputProps): React.ReactElement {
  const [message, setMessage] = React.useState("");

  const postMessage = useService("messageService", "postMessage", {
    onSuccess: () => {
      setMessage("");
      onMessageSent?.();
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
        placeholder="Type a message..."
        value={message}
        onChange={(e) => { setMessage(e.target.value); }}
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
