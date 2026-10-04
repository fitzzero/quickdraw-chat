"use client";

import * as React from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { MessageList, type PendingMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { qd, useQuickdraw } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";

export interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  const errorText = useErrorText();
  const { isConnected, userId } = useQuickdraw();

  // The chat's live history, the byChat collection: newest first (the
  // contract's order), so the first page is the latest 50 and loadMore walks
  // back in time by cursor. Messages anyone posts or deletes arrive as
  // deltas, and after a reconnect the scope resumes from its revision.
  const { items, byId, isLoading, hasMore, isLoadingMore, loadMore } =
    qd.messageService.byChat.useCollection(chatId || null);
  // The window reads oldest first
  const messages = React.useMemo(() => [...items].reverse(), [items]);

  // Sending shows the message at once, marked as sending, until byChat
  // delivers the server's row; a refusal leaves it, marked, with a retry.
  // quickdraw-5.0 finding: an optimistic update cannot add a row: the optimistic cache has patchEntity, removeEntity and patchItem, nothing that puts a new item into a collection, so a send (a create, the textbook optimistic case) is shown by hand from the mutation's variables until the collection holds the id it returned
  const {
    mutate: post,
    variables,
    data: sent,
    isPending,
    error,
  } = qd.messageService.postMessage.useMutation();
  const delivered = sent !== undefined && byId.has(sent.id);
  const pending = React.useMemo<PendingMessage | null>(() => {
    if (variables === undefined || variables.chatId !== chatId || delivered) return null;
    if (error !== null) {
      return {
        content: variables.content,
        failure: errorText(error),
        onRetry: () => {
          post(variables);
        },
      };
    }
    return isPending || sent !== undefined ? { content: variables.content, failure: null } : null;
  }, [variables, chatId, delivered, error, errorText, isPending, sent, post]);

  const handleSend = React.useCallback(
    (content: string) => {
      post({ chatId, content });
    },
    [post, chatId],
  );

  const handleLoadOlder = React.useCallback(() => {
    void loadMore();
  }, [loadMore]);

  if (!chatId) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">{t("selectChat")}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        currentUserId={userId}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadOlder={handleLoadOlder}
        pending={pending}
      />

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={!isConnected} sending={isPending} />
    </Box>
  );
}
