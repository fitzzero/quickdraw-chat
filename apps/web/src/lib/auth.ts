import type { AuthRoutesTarget, QuickdrawStatus } from "@fitzzero/quickdraw-core/client";

/** The API's URL, baked into the bundle at build time. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Where the API's auth routes are (quickdraw's auth routes kit, mounted
 * under `/auth`), for the client's helpers: `authProviders(AUTH_ROUTES)`
 * lists the sign-ins the API serves, `signInUrl(provider, AUTH_ROUTES)`
 * starts one, `signOut(AUTH_ROUTES)` and `signOutEverywhere(AUTH_ROUTES)`
 * end one session or every session of the user (all three reject when the
 * API refuses or cannot be reached: after a sign-out, the session may still
 * be live).
 *
 * Authentication is cookie-based: the API sets an httpOnly session cookie when
 * a sign-in completes, the socket's handshake carries it, and the server's
 * hello names the user (`useQuickdraw().userId`). No tokens are stored
 * client-side. After a sign-out, navigate with a full page load so the
 * socket reconnects signed out.
 */
export const AUTH_ROUTES: AuthRoutesTarget = {
  apiUrl: API_URL,
};

/**
 * The served sign-ins' query key: the login page reads `authProviders` with
 * plain TanStack Query, since no quickdraw method serves them.
 */
export const SIGN_IN_PROVIDERS_KEY = ["auth", "providers"] as const;

/**
 * Whether the server ended the session (signed out on another device,
 * revoked, expired) or refused a connect for it, from `useQuickdraw()`:
 * nobody is known and the connection stopped (`status` "disconnected" or
 * "refused"), so the user is signed out and what quickdraw cached is gone.
 * Nobody known under any other status is still connecting.
 */
export function sessionEnded({
  isKnown,
  status,
}: Pick<QuickdrawStatus, "isKnown" | "status">): boolean {
  return !isKnown && (status === "disconnected" || status === "refused");
}
