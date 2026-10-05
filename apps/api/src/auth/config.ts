// The auth settings the server reads from its environment, once: the secrets,
// the web app's and the API's URLs, and how far to trust the proxy in front
// (which decides the client's address and whether a request came over HTTPS).

import type { AllowedOrigin } from "@fitzzero/quickdraw-core/server/auth";

const DEV_JWT_SECRET = "development-secret-DO-NOT-USE-IN-PRODUCTION";

/**
 * Signs the session JWTs (the auth routes, `socketAuth`, and the app's own
 * routes that issue sessions): 32 characters or more. Required in production
 * (`index.ts` validates the environment); development falls back to a fixed
 * secret.
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

/** ENCRYPTION_KEY's shape: 32 bytes as 64 hex characters (`openssl rand -hex 32`). */
const ENCRYPTION_KEY_FORMAT = /^[0-9a-f]{64}$/i;

/**
 * What is wrong with ENCRYPTION_KEY, which encrypts stored provider tokens
 * (AES-256-GCM), or `null` when nothing is: unset is fine here (production
 * requires it through `validateEnv` in `index.ts`; development then stores
 * tokens plain), but a set key must be 64 hex characters, or every sign-in
 * fails at its first encryption. The server refuses to boot on an answer.
 */
export function encryptionKeyProblem(key: string | undefined): string | null {
  if (key === undefined || key === "" || ENCRYPTION_KEY_FORMAT.test(key)) return null;
  return "ENCRYPTION_KEY must be 64 hex characters (32 bytes: openssl rand -hex 32)";
}

/** The web app's origin: where sign-ins return, and the first allowed origin. */
export function clientUrl(): string {
  return process.env.CLIENT_URL ?? "http://localhost:3000";
}

/** EXTRA_ALLOWED_ORIGINS' entries: the web app's origins beside CLIENT_URL, comma-separated. */
function extraAllowedOrigins(): string[] {
  return (process.env.EXTRA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** API_URL, unless it is unset or empty. */
function apiUrlFromEnv(): string | undefined {
  const value = process.env.API_URL?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** Where the API listens on this machine: API_URL's fallback, for local development. */
function localApiUrl(): string {
  const port = process.env.BACKEND_PORT ?? process.env.PORT ?? "4000";
  return `http://localhost:${port}`;
}

/** Host names of this machine: localhost, `*.localhost`, 127.x.x.x and [::1]. */
const LOOPBACK_HOST = /^(?:localhost|(?:[a-z0-9-]+\.)+localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** `value` as a URL, or `null` when it is not one (`allowedOriginsFromEnv` refuses those). */
function urlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Why the API must not start as configured, or `null`: API_URL is unset
 * while the web app is served from another machine (CLIENT_URL, or an
 * EXTRA_ALLOWED_ORIGINS entry, that is not localhost), so the localhost
 * fallback would send every sign-in to `http://localhost:<port>`, which a
 * visitor's browser cannot reach (each provider's redirect URI, the mock's
 * picker). In every NODE_ENV; local development, with every web origin on
 * localhost, keeps the fallback.
 */
export function apiUrlProblem(): string | null {
  if (apiUrlFromEnv() !== undefined) return null;
  const named = [
    { url: urlOrNull(clientUrl()), what: "CLIENT_URL is" },
    ...extraAllowedOrigins().map((origin) => ({
      url: urlOrNull(origin),
      what: "EXTRA_ALLOWED_ORIGINS lists",
    })),
  ];
  const remote = named.find(
    (entry): entry is { url: URL; what: string } =>
      entry.url !== null && !LOOPBACK_HOST.test(entry.url.hostname),
  );
  if (remote === undefined) return null;
  return (
    `API_URL is required: ${remote.what} ${remote.url.origin}, not this machine, so sign-in ` +
    `redirects would point at ${localApiUrl()}. Set API_URL to the API's public URL`
  );
}

/**
 * The API's public URL: OAuth redirect URIs are
 * `{apiUrl}/auth/{provider}/callback`. API_URL, else `http://localhost:<port>`
 * for local development; throws what {@link apiUrlProblem} answers rather
 * than fall back for a web app on another machine.
 */
export function apiUrl(): string {
  const problem = apiUrlProblem();
  if (problem !== null) throw new Error(problem);
  return apiUrlFromEnv() ?? localApiUrl();
}

/** Express's `trust proxy`: how many proxies in front of the API to believe, or all (`true`) or none (`false`). */
export type TrustProxy = number | boolean;

/** Where {@link trustProxyFromEnv} took the setting from. */
export type TrustProxySource = "TRUST_PROXY" | "production" | "API_URL" | "default";

/** TRUST_PROXY's values: a number of proxy hops, or true/false. */
const TRUST_PROXY_FORMAT = /^(?:\d+|true|false)$/i;

/**
 * Express's `trust proxy`, which decides the client address the rate limits
 * count (`req.ip`, from X-Forwarded-For) and whether a request came over
 * HTTPS (`req.secure`, from X-Forwarded-Proto):
 *
 * - TRUST_PROXY, when set: the number of proxies in front of the API, or
 *   `true` (every hop, so any client can name its own address) or `false`;
 * - else `1` in production (Cloud Run's front end, a reverse proxy);
 * - else `1` when API_URL is an `https:` URL (`source: "API_URL"`, which the
 *   server logs as inferred): a hosted instance outside production, behind
 *   whatever ends its TLS (a tunnel, a reverse proxy);
 * - else off: local development, where nothing in front sets those headers.
 *
 * `problem` instead when TRUST_PROXY is set to anything else: the server
 * refuses to boot.
 */
export function trustProxyFromEnv():
  | { readonly value: TrustProxy; readonly source: TrustProxySource }
  | { readonly problem: string } {
  const set = process.env.TRUST_PROXY?.trim() ?? "";
  if (set !== "") {
    if (!TRUST_PROXY_FORMAT.test(set)) {
      return {
        problem: `TRUST_PROXY must be a number of proxy hops (1 behind one proxy) or true/false, not "${set}"`,
      };
    }
    const value: TrustProxy = /^\d+$/.test(set) ? Number(set) : set.toLowerCase() === "true";
    return { value, source: "TRUST_PROXY" };
  }
  if (process.env.NODE_ENV === "production") return { value: 1, source: "production" };
  const api = apiUrlFromEnv();
  if (api !== undefined && urlOrNull(api)?.protocol === "https:") {
    return { value: 1, source: "API_URL" };
  }
  return { value: false, source: "default" };
}

/** GitHub Codespace forwarded-port origins, outside production. */
const CODESPACE_ORIGIN = /^https:\/\/[a-z0-9-]+-[a-z0-9-]+-\d+\.app\.github\.dev$/;
/** Any localhost port, outside production. */
const LOCALHOST_ORIGIN = /^http:\/\/localhost:\d+$/;

/**
 * The web app's origins, one list for CORS, the sign-in return and the pages
 * that may open a socket with the session cookie: CLIENT_URL first (where a
 * sign-in without `returnTo` lands), then EXTRA_ALLOWED_ORIGINS, and
 * Codespaces and localhost outside production (anyone can open a Codespace:
 * in production it would be an open sign-in redirect and a cookie origin).
 */
export function allowedOriginsFromEnv(): AllowedOrigin[] {
  return [
    new URL(clientUrl()).origin,
    ...extraAllowedOrigins().map((origin) => new URL(origin).origin),
    ...(process.env.NODE_ENV === "production" ? [] : [CODESPACE_ORIGIN, LOCALHOST_ORIGIN]),
  ];
}

/** True when `origin` is one of `allowed` (an exact origin or an anchored pattern). */
export function isAllowedOrigin(allowed: readonly AllowedOrigin[], origin: string): boolean {
  return allowed.some((entry) =>
    typeof entry === "string" ? entry === origin : entry.test(origin),
  );
}
