// Re-export typed hooks from quickdraw-core
// These wrap the generic hooks with project-specific types

export { useService } from "./useService";
export { useServiceQuery } from "./useServiceQuery";
export { useSubscription } from "./useSubscription";
export { useCollection, useRoomEvents } from "@fitzzero/quickdraw-core/client";
export { useIsMobile } from "./useIsMobile";
export { useMyChats } from "./useMyChats";
export { useFilteredNavigation } from "./useFilteredNavigation";
export { useSlowLoadHint } from "./useSlowLoadHint";
export { useServiceWorker } from "./useServiceWorker";
export { usePushNotifications, type UsePushNotificationsResult } from "./usePushNotifications";

// Admin hooks
export { useAdminServices, type AdminServiceInfo } from "./useAdminServices";
export { useAdminMeta } from "./useAdminMeta";
export { useAdminList, type AdminListResponse } from "./useAdminList";

// Re-export i18n hook from next-intl
export { useTranslations } from "next-intl";
