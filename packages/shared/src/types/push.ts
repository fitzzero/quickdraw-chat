// ============================================================================
// Push Service Types - Web Push subscriptions (PWA); the methods are in the
// push contract (contracts/push.ts)
// ============================================================================

/**
 * The JSON payload delivered to the service worker (`apps/web/public/sw.js`)
 * via Web Push. Keep it small — push endpoints cap payloads at ~4kb.
 */
export interface PushNotificationPayload {
  title: string;
  body: string;
  /** Click-through path (app-relative, e.g. `/chats/abc123`). */
  url: string;
  /** Notification dedupe key — later pushes with the same tag replace earlier ones. */
  tag?: string;
}
