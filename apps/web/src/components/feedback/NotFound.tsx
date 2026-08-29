"use client";

import * as React from "react";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { useTranslations } from "next-intl";
import { FeedbackPanel } from "./FeedbackPanel";

interface NotFoundProps {
  message?: string;
  backHref?: string;
  backLabel?: string;
}

export function NotFound({
  message,
  backHref = "/",
  backLabel,
}: NotFoundProps): React.ReactElement {
  const t = useTranslations("NotFound");
  const tCommon = useTranslations("Common");

  return (
    <FeedbackPanel
      icon={SearchOffIcon}
      iconColor="text.secondary"
      title={t("title")}
      message={message ?? t("defaultMessage")}
      actionHref={backHref}
      actionLabel={backLabel ?? tCommon("goHome")}
    />
  );
}
