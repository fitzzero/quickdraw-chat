/**
 * Client-side auth helpers.
 *
 * Authentication is cookie-based: the API sets an httpOnly session cookie on
 * OAuth completion, the socket handshake carries it (withCredentials), and
 * the server reports identity via the `auth:info` event — consume it through
 * `useSocket().userId`. No tokens are stored client-side.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Get the API URL for OAuth redirect
 */
export function getOAuthUrl(provider: "discord" | "google" | "mock"): string {
  return `${API_URL}/auth/${provider}`;
}

/**
 * Whether the dev-only mock OAuth login is enabled (never in production —
 * the API hard-blocks it server-side as well).
 */
export function isMockLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_MOCK_OAUTH === "true";
}

/**
 * Logout from current session (invalidates the session server-side and
 * clears the session cookie). Callers must follow with a full page
 * navigation (window.location) so the socket reconnects unauthenticated.
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    // Ignore network errors — the session cookie may already be gone
  }
}

/**
 * Logout from all devices (invalidates every session for the user).
 * Returns the number of sessions that were invalidated. Callers must follow
 * with a full page navigation, same as logout().
 */
export async function logoutAllDevices(): Promise<number> {
  try {
    const response = await fetch(`${API_URL}/auth/sessions`, {
      method: "DELETE",
      credentials: "include",
    });

    if (response.ok) {
      const data = (await response.json()) as { sessionsDeleted?: number };
      return data.sessionsDeleted ?? 0;
    }
  } catch {
    // Ignore network errors
  }
  return 0;
}
