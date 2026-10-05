"use client";

import * as React from "react";
import { Box, Button, Typography, Avatar, Paper, CircularProgress } from "@mui/material";
import { useTranslations } from "next-intl";
import type { MessageDTO } from "@project/shared";

/** A message the user sent that the server refused: kept, marked, with a retry. */
export interface FailedMessage {
  /** Tells this refused send from the others. */
  readonly key: string;
  readonly content: string;
  /** Why it was not sent, for people. */
  readonly reason: string;
  /** Sends it again. */
  readonly onRetry?: () => void;
  /** Lets it go, unsent. */
  readonly onDismiss?: () => void;
}

export interface MessageListProps {
  /** Oldest first. */
  messages: readonly MessageDTO[];
  /**
   * The ids among `messages` still on their way to the server, shown as
   * sending: `useCollection`'s `pending` (the optimistic adds in flight).
   */
  pending?: ReadonlySet<string>;
  /**
   * The ids among `pending` whose send lost its answer (the connection
   * dropped after it went out, or it timed out), shown as checking until the
   * chat's next load says whether the server has them: `useCollection`'s
   * `checking`.
   */
  checking?: ReadonlySet<string>;
  isLoading: boolean;
  currentUserId?: string | null;
  /** Older history exists beyond the loaded window */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadOlder?: () => void;
  /** The user's messages the server refused, oldest first, shown last with a retry each. */
  failed?: readonly FailedMessage[];
}

const NOTHING_PENDING: ReadonlySet<string> = new Set();
const NOTHING_FAILED: readonly FailedMessage[] = [];

/** One of the user's own messages the server refused, at the end of the list. */
function FailedBubble({ failed }: { failed: FailedMessage }): React.ReactElement {
  const t = useTranslations("MessageList");
  return (
    <Box data-testid="failed-message" sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
      <Paper
        elevation={1}
        sx={{
          p: 1.5,
          mx: 6,
          maxWidth: "70%",
          bgcolor: "background.paper",
          border: 1,
          borderColor: "error.main",
          borderRadius: 2,
        }}
      >
        <Typography variant="body2">{failed.content}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <Typography variant="caption" color="error">
            {t("notSent", { reason: failed.reason })}
          </Typography>
          {failed.onRetry && (
            <Button size="small" color="error" onClick={failed.onRetry}>
              {t("retry")}
            </Button>
          )}
          {failed.onDismiss && (
            <Button size="small" color="inherit" onClick={failed.onDismiss}>
              {t("dismiss")}
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  );
}

export function MessageList({
  messages,
  pending = NOTHING_PENDING,
  checking = NOTHING_PENDING,
  isLoading,
  currentUserId,
  hasMore = false,
  isLoadingMore = false,
  onLoadOlder,
  failed = NOTHING_FAILED,
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
  const lastFailed = failed.length > 0 ? failed[failed.length - 1] : undefined;
  const newest = lastFailed === undefined ? lastMessageId : `failed:${lastFailed.key}`;
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

  if (messages.length === 0 && failed.length === 0) {
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
        // On its way: shown at once, marked, until the server has it; checking
        // while a lost answer leaves open whether it does
        const isSending = pending.has(message.id);
        const sendingStatus = checking.has(message.id) ? t("checking") : t("sending");

        return (
          <Box
            key={message.id}
            data-testid={isSending ? "pending-message" : undefined}
            aria-busy={isSending || undefined}
            sx={{
              display: "flex",
              justifyContent: isOwnMessage ? "flex-end" : "flex-start",
              mb: 2,
              opacity: isSending ? 0.6 : 1,
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
                  {isSending ? sendingStatus : new Date(message.createdAt).toLocaleTimeString()}
                </Typography>
              </Paper>
            </Box>
          </Box>
        );
      })}
      {failed.map((refused) => (
        <FailedBubble key={refused.key} failed={refused} />
      ))}
    </Box>
  );
}
