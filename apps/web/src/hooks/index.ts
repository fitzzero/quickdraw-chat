// Re-export typed hooks from quickdraw-core
// These wrap the generic hooks with project-specific types

export { useService } from "./useService";
export { useServiceQuery } from "./useServiceQuery";
export { useSubscription } from "./useSubscription";
export { useIsMobile } from "./useIsMobile";
export { useRecentChats } from "./useRecentChats";

// Admin hooks
export { useAdminServices, type AdminServiceInfo } from "./useAdminServices";
export { useAdminMeta } from "./useAdminMeta";
export { useAdminList, type AdminListResponse } from "./useAdminList";

// Re-export i18n hook from next-intl
export { useTranslations } from "next-intl";
