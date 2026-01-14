const AUTH_TOKEN_KEY = "auth_token";

/**
 * Get the stored auth token from localStorage
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Store the auth token in localStorage
 */
export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  // Dispatch custom event for same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new Event("auth-token-changed"));
}

/**
 * Remove the auth token from localStorage
 */
export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  // Dispatch custom event for same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new Event("auth-token-changed"));
}

interface JWTPayload {
  userId: string;
  email?: string;
}

/**
 * Parse JWT payload (client-side only, not verified)
 */
export function parseJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    
    const decoded = atob(parts[1]);
    const payload: unknown = JSON.parse(decoded);
    
    if (
      typeof payload === "object" &&
      payload !== null &&
      "userId" in payload &&
      typeof (payload as { userId: unknown }).userId === "string"
    ) {
      const typedPayload = payload as { userId: string; email?: string };
      return {
        userId: typedPayload.userId,
        email: typedPayload.email,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the API URL for OAuth redirect
 */
export function getOAuthUrl(provider: "discord" | "google"): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${apiUrl}/auth/${provider}`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Logout from current session (invalidate token on server and clear localStorage)
 */
export async function logout(): Promise<void> {
  const token = getAuthToken();
  
  if (token) {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Ignore network errors - we'll clear local token anyway
    }
  }
  
  clearAuthToken();
}

/**
 * Logout from all devices (invalidate all sessions on server and clear localStorage)
 * Returns the number of sessions that were invalidated
 */
export async function logoutAllDevices(): Promise<number> {
  const token = getAuthToken();
  
  if (!token) {
    clearAuthToken();
    return 0;
  }
  
  try {
    const response = await fetch(`${API_URL}/auth/sessions`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json() as { sessionsDeleted?: number };
      clearAuthToken();
      return data.sessionsDeleted ?? 0;
    }
  } catch {
    // Ignore network errors - we'll clear local token anyway
  }
  
  clearAuthToken();
  return 0;
}
