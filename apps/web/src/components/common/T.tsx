"use client";

import { useTranslations } from "next-intl";

interface TProps {
  // e.g., "ChatList.newChat"
  k: string;
  values?: Record<string, string | number>;
}

export function T({ k, values }: TProps): React.ReactElement {
  const [namespace, ...keyParts] = k.split(".");
  const key = keyParts.join(".");
  const t = useTranslations(namespace);
  return <>{t(key, values)}</>;
}
