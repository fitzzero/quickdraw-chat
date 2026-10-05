import type { AuthRoutesTarget } from "@fitzzero/quickdraw-core/client";

/** The API's URL, baked into the bundle at build time. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  apiUrl: API_URL,
};

/** How a sign-in works: a redirect to a provider, the development picker, or a guest. */
export type SignInProviderKind = "oauth" | "mock" | "guest";

const KINDS: readonly SignInProviderKind[] = ["oauth", "mock", "guest"];

/** A sign-in the API serves, as its `GET /auth/providers` lists it. */
export interface SignInProvider {
  /** Its id: `signInUrl(id, AUTH_ROUTES)` starts it (a guest signs in with `POST /auth/guest`). */
  readonly id: string;
  /** `"oauth"` (Google, Discord, an app's own), `"mock"` (development only) or `"guest"`. */
  readonly kind: SignInProviderKind;
}

/** The served sign-ins' query key (plain TanStack Query: no quickdraw method serves them). */
export const SIGN_IN_PROVIDERS_KEY = ["auth", "providers"] as const;

/** `value` as a served sign-in, or `null` for an entry of a shape or kind this page does not know. */
function signInProviderOf(value: unknown): SignInProvider | null {
  if (typeof value !== "object" || value === null || !("id" in value) || !("kind" in value)) {
    return null;
  }
  const { id, kind } = value;
  const known = KINDS.find((candidate) => candidate === kind);
  return typeof id !== "string" || known === undefined ? null : { id, kind: known };
}

/**
 * The sign-ins in a `GET /auth/providers` answer,
 * `{ providers: [{ id, kind }] }`, in order; an entry of a kind this page
 * does not know is left out. Throws on any other answer.
 */
export function parseSignInProviders(body: unknown): SignInProvider[] {
  const providers =
    typeof body === "object" && body !== null && "providers" in body ? body.providers : null;
  if (!Array.isArray(providers)) {
    throw new TypeError("GET /auth/providers answered no providers list");
  }
  return providers.flatMap((entry: unknown) => {
    const provider = signInProviderOf(entry);
    return provider === null ? [] : [provider];
  });
}

/**
 * The sign-ins the API serves (`GET /auth/providers`), so the login page
 * offers those and no others: a provider the API has no credentials for
 * answers 404. Asked of the API, never read from `NEXT_PUBLIC_*` flags,
 * which are baked in at build time and drift from the server's
 * configuration. Rejects when the API cannot be reached or answers anything
 * else.
 */
export async function fetchSignInProviders(): Promise<SignInProvider[]> {
  const response = await fetch(`${API_URL}/auth/providers`);
  if (!response.ok) {
    throw new Error(`GET /auth/providers answered ${response.status}`);
  }
  return parseSignInProviders(await response.json());
}
