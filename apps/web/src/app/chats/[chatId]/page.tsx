"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Box } from "@mui/material";
import { useTranslations } from "next-intl";
import { ChatWindow, ChatSidebar } from "../../../components/chat";
import { usePageTitle, useRightSidebar } from "../../../providers";
import { qd } from "../../../lib/quickdraw";
import { NotFound, NoPermission } from "../../../components/feedback";

export default function ChatPage(): React.ReactElement {
  const params = useParams();
  const chatId = params.chatId as string;
  const t = useTranslations("ChatWindow");

  // The chat, live: renamed by anyone, it updates; deleted, it is removed
  const { data: chat, error, isRemoved } = qd.chatService.useEntity(chatId);

  // Set page title from chat data
  usePageTitle(chat?.title ?? null);

  // Set right sidebar content
  const sidebarContent = React.useMemo(() => <ChatSidebar chatId={chatId} />, [chatId]);
  useRightSidebar(sidebarContent);

  // Not a member (or removed from the chat while viewing it): FORBIDDEN;
  // deleted, or never there: removed
  if (error?.code === "FORBIDDEN") {
    return <NoPermission message={t("noAccess")} />;
  }
  if (error !== null || isRemoved) {
    return <NotFound message={t("notFound")} backHref="/chats" backLabel={t("backToChats")} />;
  }

  // Loading state handled by ChatWindow
  return (
    <Box
      sx={{
        height: "calc(100vh - 128px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ChatWindow chatId={chatId} />
    </Box>
  );
}
