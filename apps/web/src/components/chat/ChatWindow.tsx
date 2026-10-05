"use client";

import * as React from "react";
import { Box, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useQuickdraw } from "@fitzzero/quickdraw-core/client";
import { MessageList, type FailedMessage } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { qd } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";

export interface ChatWindowProps {
  chatId: string;
}

export function ChatWindow({ chatId }: ChatWindowProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  const errorText = useErrorText();
  const { isConnected, userId } = useQuickdraw();
  // The sender's own profile: the author of a message shown before the server has it
  const { data: me } = qd.userService.useEntity(userId);

  // The chat's live history, the byChat collection: newest first (the
  // contract's order), so the first page is the latest 50 and loadMore walks
  // back in time by cursor. Messages anyone posts or deletes arrive as
  // deltas, and after a reconnect the scope resumes from its revision.
  const { items, pending, refused, isLoading, hasMore, isLoadingMore, loadMore } =
    qd.messageService.byChat.useCollection(chatId || null);
  // The window reads oldest first
  const messages = React.useMemo(() => [...items].reverse(), [items]);

  // Sending shows the message at once: the optimistic add puts it in byChat,
  // newest (its createdAt), flagged in `pending` while the call is on its
  // way, and the server's row takes its place. A refused send is kept
  // (`onRefused: "keep"`): it leaves the items for the scope's `refused`,
  // which the window shows last, marked, until the user retries it (the same
  // call again, pending again) or dismisses it. The client holds them, not
  // this component: they outlive the window, and no later send drops one.
  const { mutate: post } = qd.messageService.postMessage.useMutation({
    optimistic: (input, cache) => {
      if (userId === null) return;
      cache.addItem(
        "byChat",
        input.chatId,
        {
          chatId: input.chatId,
          userId,
          content: input.content,
          role: input.role ?? "user",
          createdAt: new Date().toISOString(),
          user: { id: userId, name: me?.name ?? null, image: me?.image ?? null },
        },
        { onRefused: "keep" },
      );
    },
  });
  const failed = React.useMemo<FailedMessage[]>(
    () =>
      refused.map((send) => ({
        key: send.item.id,
        content: send.item.content,
        reason: errorText(send.error),
        onRetry: () => {
          void send.retry();
        },
        onDismiss: () => {
          send.dismiss();
        },
      })),
    [refused, errorText],
  );

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
        pending={pending}
        isLoading={isLoading}
        currentUserId={userId}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadOlder={handleLoadOlder}
        failed={failed}
      />

      {/* Input: one message on its way at a time, as the list shows it (a
          retried one too, which the mutation's own state never sees) */}
      <MessageInput onSend={handleSend} disabled={!isConnected} sending={pending.size > 0} />
    </Box>
  );
}
