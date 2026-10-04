// The auth settings the server reads from its environment, once.

import type { AllowedOrigin } from "@fitzzero/quickdraw-core/server/auth";

const DEV_JWT_SECRET = "development-secret-DO-NOT-USE-IN-PRODUCTION";

/**
 * Signs the session JWTs (the auth routes, `socketAuth`, the Discord Activity
 * route): 32 characters or more. Required in production (`index.ts`
 * validates the environment); development falls back to a fixed secret.
 */
export function jwtSecretFromEnv(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  return DEV_JWT_SECRET;
}

/** The web app's origin: where sign-ins return, and the first allowed origin. */
export function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:3000";
}

/** The API's public URL: OAuth redirect URIs are `{apiUrl}/auth/{provider}/callback`. */
export function apiUrl(): string {
  const port = process.env.BACKEND_PORT ?? process.env.PORT ?? "4000";
  return process.env.API_URL ?? `http://localhost:${port}`;
}

/** GitHub Codespace forwarded-port origins. */
const CODESPACE_ORIGIN = /^https:\/\/[a-z0-9-]+-[a-z0-9-]+-\d+\.app\.github\.dev$/;
/** Any localhost port, outside production. */
const LOCALHOST_ORIGIN = /^http:\/\/localhost:\d+$/;

/**
 * The web app's origins, one list for CORS, the sign-in return and the pages
 * that may open a socket with the session cookie: CLIENT_URL first (where a
 * sign-in without `returnTo` lands), then EXTRA_ALLOWED_ORIGINS, Codespaces,
 * and localhost outside production, as 4.x's `validateRedirectOrigin` allowed.
 */
export function allowedOriginsFromEnv(): AllowedOrigin[] {
  const extra = (process.env.EXTRA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return [
    new URL(clientUrl()).origin,
    ...extra.map((origin) => new URL(origin).origin),
    CODESPACE_ORIGIN,
    ...(process.env.NODE_ENV === "production" ? [] : [LOCALHOST_ORIGIN]),
  ];
}

/** True when `origin` is one of `allowed` (an exact origin or an anchored pattern). */
export function isAllowedOrigin(allowed: readonly AllowedOrigin[], origin: string): boolean {
  return allowed.some((entry) =>
    typeof entry === "string" ? entry === origin : entry.test(origin),
  );
}
