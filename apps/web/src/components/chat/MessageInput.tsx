"use client";

import * as React from "react";
import { Box, TextField, IconButton, CircularProgress } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useTranslations } from "next-intl";

export interface MessageInputProps {
  /** Sends a message; the field clears at once (the list shows it as sending). */
  onSend: (content: string) => void;
  disabled?: boolean;
  /** A message is on its way: one at a time. */
  sending?: boolean;
}

export function MessageInput({
  onSend,
  disabled = false,
  sending = false,
}: MessageInputProps): React.ReactElement {
  const t = useTranslations("MessageInput");
  const [message, setMessage] = React.useState("");

  const handleSend = () => {
    const content = message.trim();
    if (content && !sending && !disabled) {
      onSend(content);
      setMessage("");
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
        disabled={disabled}
        size="small"
      />
      <IconButton
        color="primary"
        onClick={handleSend}
        disabled={!message.trim() || sending || disabled}
        aria-label={t("send")}
      >
        {sending ? <CircularProgress size={24} /> : <SendIcon />}
      </IconButton>
    </Box>
  );
}
