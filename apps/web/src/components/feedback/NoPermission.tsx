"use client";

import * as React from "react";
import BlockIcon from "@mui/icons-material/Block";
import { useTranslations } from "next-intl";
import { FeedbackPanel } from "./FeedbackPanel";

export interface NoPermissionProps {
  message?: string;
}

export function NoPermission({ message }: NoPermissionProps): React.ReactElement {
  const t = useTranslations("NoPermission");
  const tCommon = useTranslations("Common");

  return (
    <FeedbackPanel
      icon={BlockIcon}
      iconColor="error.main"
      title={t("title")}
      message={message ?? t("defaultMessage")}
      actionHref="/"
      actionLabel={tCommon("goHome")}
    />
  );
}
