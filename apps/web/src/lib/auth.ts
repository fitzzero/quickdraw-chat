import type { AuthRoutesTarget } from "@fitzzero/quickdraw-core/client";

/**
 * Where the API's auth routes are (quickdraw's auth routes kit, mounted
 * under `/auth`), for the client's helpers: `signInUrl(provider, AUTH_ROUTES)`
 * starts a sign-in, `signOut(AUTH_ROUTES)` and `signOutEverywhere(AUTH_ROUTES)`
 * end one session or every session of the user (both reject when the API
 * refuses or cannot be reached: the session may still be live).
 *
 * Authentication is cookie-based: the API sets an httpOnly session cookie when
 * a sign-in completes, the socket's handshake carries it, and the server's
 * hello names the user (`useQuickdraw().userId`). No tokens are stored
 * client-side. After a sign-out, navigate with a full page load so the
 * socket reconnects signed out.
 */
export const AUTH_ROUTES: AuthRoutesTarget = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
};

/**
 * Whether the dev-only mock OAuth login is enabled (never in production —
 * the API hard-blocks it server-side as well).
 */
export function isMockLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_MOCK_OAUTH === "true";
}
