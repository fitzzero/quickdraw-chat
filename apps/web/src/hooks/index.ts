// Re-export typed hooks from quickdraw-core
// These wrap the generic hooks with project-specific types

export { useService } from "./useService";
export { useSubscription } from "./useSubscription";
export { useIsMobile } from "./useIsMobile";
export { useRecentChats } from "./useRecentChats";

// Re-export i18n hook from next-intl
export { useTranslations } from "next-intl";
