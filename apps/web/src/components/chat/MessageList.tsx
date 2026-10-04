"use client";

import * as React from "react";
import { Box, Button, Typography, Avatar, Paper, CircularProgress } from "@mui/material";
import { useTranslations } from "next-intl";
import type { MessageDTO } from "@project/shared";

/** A message the user sent that the chat's history does not hold yet. */
export interface PendingMessage {
  readonly content: string;
  /** Why it was not sent; `null` while it is on its way. */
  readonly failure: string | null;
  /** Sends it again, after a failure. */
  readonly onRetry?: () => void;
}

export interface MessageListProps {
  /** Oldest first. */
  messages: readonly MessageDTO[];
  isLoading: boolean;
  currentUserId?: string | null;
  /** Older history exists beyond the loaded window */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadOlder?: () => void;
  /** The user's message being sent, shown last until the history holds it. */
  pending?: PendingMessage | null;
}

/** The user's own message on its way (or refused), at the end of the list. */
function PendingBubble({ pending }: { pending: PendingMessage }): React.ReactElement {
  const t = useTranslations("MessageList");
  const failed = pending.failure !== null;
  return (
    <Box
      data-testid="pending-message"
      aria-busy={!failed}
      sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}
    >
      <Paper
        elevation={1}
        sx={{
          p: 1.5,
          mx: 6,
          maxWidth: "70%",
          bgcolor: failed ? "background.paper" : "primary.dark",
          border: failed ? 1 : 0,
          borderColor: "error.main",
          borderRadius: 2,
          opacity: failed ? 1 : 0.6,
        }}
      >
        <Typography variant="body2">{pending.content}</Typography>
        {failed ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
            <Typography variant="caption" color="error">
              {t("notSent", { reason: pending.failure ?? "" })}
            </Typography>
            {pending.onRetry && (
              <Button size="small" color="error" onClick={pending.onRetry}>
                {t("retry")}
              </Button>
            )}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {t("sending")}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

export function MessageList({
  messages,
  isLoading,
  currentUserId,
  hasMore = false,
  isLoadingMore = false,
  onLoadOlder,
  pending = null,
}: MessageListProps): React.ReactElement {
  const t = useTranslations("MessageList");
  const tCommon = useTranslations("Common");
  const listRef = React.useRef<HTMLDivElement>(null);

  // Scroll the list container directly — scrollIntoView would also scroll
  // every scrollable ancestor, which shifts the page behind an overlaid
  // chat. Follow the conversation only when the *newest* message changes
  // (a message sent, or delivered) — paging older history in at the top
  // must not yank the scroll down.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
  const newest = pending === null ? lastMessageId : `pending:${pending.content}`;
  React.useEffect(() => {
    const list = listRef.current;
    if (list && newest) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [newest]);

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

  if (messages.length === 0 && pending === null) {
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
                src={message.user.image ?? undefined}
                sx={{
                  width: 32,
                  height: 32,
                  mx: 1,
                  bgcolor: isOwnMessage ? "primary.main" : "secondary.main",
                }}
              >
                {message.user.name?.[0] ?? "U"}
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
                  {message.user.name ?? tCommon("unknownUser")}
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
      {pending !== null && <PendingBubble pending={pending} />}
    </Box>
  );
}
