/**
 * Client-side auth helpers, over the API's auth routes (quickdraw's auth
 * routes kit, mounted under `/auth`).
 *
 * Authentication is cookie-based: the API sets an httpOnly session cookie when
 * a sign-in completes, the socket's handshake carries it, and the server's
 * hello names the user (`useQuickdraw().userId`). No tokens are stored
 * client-side.
 */

// quickdraw-5.0 finding: @fitzzero/quickdraw-core/client still exports 4.x's getOAuthUrl, logout and logoutAllDevices, which call routes the 5.0 auth routes kit does not serve (/auth/<provider> without /start, DELETE /auth/logout, DELETE /auth/sessions) and send only a stored bearer token, so with cookie sessions they sign nobody out; these are the app's own

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Where a sign-in with `provider` starts. The API returns to this page's
 * origin (`returnTo`, checked against its allowed origins) at
 * `/auth/callback`, or at `/auth/login?error=state|denied|failed`.
 */
export function getOAuthUrl(provider: "discord" | "google" | "mock"): string {
  const returnTo =
    typeof window === "undefined" ? "" : `?returnTo=${encodeURIComponent(window.location.origin)}`;
  return `${API_URL}/auth/${provider}/start${returnTo}`;
}

/**
 * Whether the dev-only mock OAuth login is enabled (never in production —
 * the API hard-blocks it server-side as well).
 */
export function isMockLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_MOCK_OAUTH === "true";
}

/** POSTs to an auth route: JSON, which a cross-site form cannot send, with the cookie. */
async function postAuthRoute(path: "logout" | "logout-all"): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    return response.ok;
  } catch {
    // Network errors: the session cookie may already be gone
    return false;
  }
}

/**
 * Logout from current session (revokes the session server-side, which ends
 * its open sockets, and clears the session cookie). Callers must follow with
 * a full page navigation (window.location) so the socket reconnects
 * unauthenticated.
 */
export async function logout(): Promise<void> {
  await postAuthRoute("logout");
}

/**
 * Logout from all devices (revokes every session of the user, and their open
 * sockets). Resolves true when the API accepted it. Callers must follow with
 * a full page navigation, same as logout().
 */
export async function logoutAllDevices(): Promise<boolean> {
  return await postAuthRoute("logout-all");
}
