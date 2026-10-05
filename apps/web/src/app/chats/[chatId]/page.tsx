"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Box } from "@mui/material";
import SpeakerNotesOffIcon from "@mui/icons-material/SpeakerNotesOff";
import { useTranslations } from "next-intl";
import { ChatWindow, ChatSidebar } from "../../../components/chat";
import { usePageTitle, useRightSidebar } from "../../../providers";
import { qd } from "../../../lib/quickdraw";
import { FeedbackPanel, NotFound } from "../../../components/feedback";

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

  // FORBIDDEN is the server's answer for a chat the user is no member of,
  // and for one that does not exist (deleted while the page was offline, or
  // never there): it never tells a stranger which chat ids exist. So the page
  // says both. A chat deleted while open arrives as removed: that one is gone.
  if (error?.code === "FORBIDDEN") {
    return (
      <FeedbackPanel
        icon={SpeakerNotesOffIcon}
        iconColor="text.secondary"
        title={t("unavailableTitle")}
        message={t("unavailable")}
        actionHref="/chats"
        actionLabel={t("backToChats")}
      />
    );
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
