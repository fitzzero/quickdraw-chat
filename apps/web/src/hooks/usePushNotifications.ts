"use client";

import * as React from "react";
import { useService } from "./useService";

// Non-secret by design — safe to inline into the client bundle.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** Web Push applicationServerKey wants the VAPID key as raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface UsePushNotificationsResult {
  /** Browser + config support; false until mounted (SSR-stable). */
  supported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  isBusy: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/**
 * Browser push-notification opt-in for the current device. `subscribe()`
 * runs the permission prompt, registers the endpoint with the push service,
 * and records it via pushService.subscribePush; `unsubscribe()` reverses it.
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const [supported, setSupported] = React.useState(false);
  const [permission, setPermission] = React.useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  const subscribeMutation = useService("pushService", "subscribePush");
  const unsubscribeMutation = useService("pushService", "unsubscribePush");

  // Detect support + current state after mount (keeps SSR markup stable)
  React.useEffect(() => {
    const isSupported =
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator &&
      !!VAPID_PUBLIC_KEY;
    setSupported(isSupported);
    if (!isSupported) return;

    setPermission(Notification.permission);
    void navigator.serviceWorker.ready.then((registration) =>
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      }),
    );
  }, []);

  const subscribe = React.useCallback(async (): Promise<void> => {
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator)) return;
    setIsBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
      });

      const json = subscription.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        subscribeMutation.mutate({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
        setIsSubscribed(true);
      }
    } finally {
      setIsBusy(false);
    }
  }, [subscribeMutation]);

  const unsubscribe = React.useCallback(async (): Promise<void> => {
    if (!("serviceWorker" in navigator)) return;
    setIsBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        unsubscribeMutation.mutate({ endpoint });
      }
      setIsSubscribed(false);
    } finally {
      setIsBusy(false);
    }
  }, [unsubscribeMutation]);

  return { supported, permission, isSubscribed, isBusy, subscribe, unsubscribe };
}
