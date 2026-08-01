"use client";

import { useEffect } from "react";

/**
 * Register the PWA service worker (`public/sw.js`). The API origin travels in
 * the registration query string so the worker's `pushsubscriptionchange`
 * handler knows where to renew subscriptions — a SW can't read NEXT_PUBLIC_*
 * env, and the web app and API are separate origins.
 */
export function useServiceWorker(apiUrl: string): void {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?apiUrl=${encodeURIComponent(apiUrl)}`).catch(() => {
      // Non-fatal: private browsing modes and older browsers just skip PWA
    });
  }, [apiUrl]);
}
