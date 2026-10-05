// The app's own hooks. Server data has none here: components read it through
// the typed client (`qd.<service>.<member>` from lib/quickdraw) and the
// connection's state through `useQuickdraw()`.
export { useIsMobile } from "./useIsMobile";
export { useFilteredNavigation } from "./useFilteredNavigation";
export { useSlowLoadHint } from "./useSlowLoadHint";
export { useServiceWorker } from "./useServiceWorker";
export { usePushNotifications, type UsePushNotificationsResult } from "./usePushNotifications";
export { useErrorText } from "./useErrorText";

// Re-export i18n hook from next-intl
export { useTranslations } from "next-intl";
