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

/** A send the server refused: kept until the user retries or dismisses it. */
interface RefusedSend {
  readonly key: string;
  readonly chatId: string;
  readonly content: string;
  readonly reason: string;
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
  const { items, pending, isLoading, hasMore, isLoadingMore, loadMore } =
    qd.messageService.byChat.useCollection(chatId || null);
  // The window reads oldest first
  const messages = React.useMemo(() => [...items].reverse(), [items]);

  // Sending shows the message at once: the optimistic add puts it in byChat,
  // newest (its createdAt), flagged in `pending` while the call is on its
  // way, and the server's row takes its place. A refused send leaves the
  // list; the window keeps each one last, marked, with a retry, until the
  // user retries or dismisses it (the hook's onError hears every send, where
  // a mutation's own state holds only the last one).
  const [refused, setRefused] = React.useState<readonly RefusedSend[]>([]);
  const refusals = React.useRef(0);
  const { mutate: post, isPending } = qd.messageService.postMessage.useMutation({
    optimistic: (input, cache) => {
      if (userId === null) return;
      cache.addItem("byChat", input.chatId, {
        chatId: input.chatId,
        userId,
        content: input.content,
        role: input.role ?? "user",
        createdAt: new Date().toISOString(),
        user: { id: userId, name: me?.name ?? null, image: me?.image ?? null },
      });
    },
    onError: (error, input) => {
      refusals.current += 1;
      const send: RefusedSend = {
        key: `refused-${refusals.current}`,
        chatId: input.chatId,
        content: input.content,
        reason: errorText(error),
      };
      setRefused((sends) => [...sends, send]);
    },
  });
  const failed = React.useMemo<FailedMessage[]>(() => {
    const drop = (key: string): void => {
      setRefused((sends) => sends.filter((send) => send.key !== key));
    };
    return refused
      .filter((send) => send.chatId === chatId)
      .map((send) => ({
        key: send.key,
        content: send.content,
        reason: send.reason,
        onRetry: () => {
          drop(send.key);
          post({ chatId: send.chatId, content: send.content });
        },
        onDismiss: () => {
          drop(send.key);
        },
      }));
  }, [refused, chatId, post]);

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

      {/* Input */}
      <MessageInput onSend={handleSend} disabled={!isConnected} sending={isPending} />
    </Box>
  );
}
