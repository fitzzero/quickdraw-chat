// ============================================================================
// Push Service Methods - Web Push subscriptions (PWA)
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

export interface PushServiceMethods {
  subscribePush: {
    payload: { endpoint: string; keys: { p256dh: string; auth: string } };
    response: { success: true };
  };
  unsubscribePush: {
    payload: { endpoint: string };
    response: { success: true };
  };
  /** Sends a test notification to every subscription of the calling user. */
  sendTestPush: {
    payload: Record<string, never>;
    response: { sent: number };
  };
}
