"use client";

import * as React from "react";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslations } from "next-intl";
import { FeedbackPanel } from "./FeedbackPanel";

export interface LoginRequiredProps {
  message?: string;
}

export function LoginRequired({ message }: LoginRequiredProps): React.ReactElement {
  const t = useTranslations("LoginRequired");
  const tAuth = useTranslations("Auth");

  return (
    <FeedbackPanel
      icon={LockOutlinedIcon}
      iconColor="text.secondary"
      title={t("title")}
      message={message ?? t("defaultMessage")}
      actionHref="/auth/login"
      actionLabel={tAuth("signIn")}
      actionVariant="contained"
    />
  );
}
