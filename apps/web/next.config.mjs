import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const apiOrigin = new URL(API_URL).origin;
// Socket.IO upgrades to a websocket on the same origin
const apiWsOrigin = apiOrigin.replace(/^http/, "ws");
const isDev = process.env.NODE_ENV !== "production";

// Report-Only CSP: violations log to the browser devtools console without
// blocking anything. Forks tighten it and move it to enforced — see
// .claude/rules/security.md.
// The game's one CSP piece (the game client itself needs nothing beyond
// the page's policy: no wasm, no workers, no blobs). The array empties when
// `init-fork.sh --without-game` strips its marker block, which drops those
// tokens from the policy (see scripts/strip-game.mjs). The markers can only
// DELETE lines, so the removable part lives in its own array rather than
// in alternative versions of the directive.
const gameFrameAncestors = [
  // ── quickdraw-game:start ──
  // The app runs inside Discord's Activity iframe.
  "https://discord.com",
  "https://*.discord.com",
  "https://*.discordsays.com",
  // ── quickdraw-game:end ──
];

/** Join directive tokens, skipping the ones that are absent. */
const directive = (...parts) => parts.filter(Boolean).join(" ");

const cspReportOnly = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js App Router bootstrap scripts (no nonce infra).
  // dev adds 'unsafe-eval' for react-refresh.
  directive("script-src 'self' 'unsafe-inline'", isDev ? "'unsafe-eval'" : ""),
  // MUI/emotion inject inline <style> tags
  "style-src 'self' 'unsafe-inline'",
  // Same-origin assets + the API (REST + Socket.IO websocket)
  `connect-src 'self' ${apiOrigin} ${apiWsOrigin}`,
  // OAuth avatars come from provider CDNs (Google/Discord) — forks should pin
  // https: to their actual avatar hosts
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// frame-ancestors is ignored in Report-Only mode (per spec), so this one
// directive ships enforced. Deliberately NO X-Frame-Options: DENY/SAMEORIGIN
// would override frame-ancestors in older browsers and block the embedding
// contexts below.
const cspEnforced = directive("frame-ancestors 'self'", ...gameFrameAncestors);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Vercel already sends HSTS on its domains (harmless duplicate);
  // self-hosted `next start` deployments need this copy.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: cspEnforced },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next allows one dev server per dist dir: check:web runs the app beside a
  // developer's with NEXT_DIST_DIR=.next-check
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@project/shared"],
  output: "standalone",
  // Monorepo: pin the workspace root explicitly — inference fails under
  // `vercel build` (bun symlink layout) and standalone tracing needs it.
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  headers() {
    return Promise.resolve([
      {
        // The service worker must revalidate on every load so new versions
        // activate without users hard-refreshing (SWs otherwise cache hard)
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      { source: "/:path*", headers: securityHeaders },
    ]);
  },
};

export default nextConfig;
