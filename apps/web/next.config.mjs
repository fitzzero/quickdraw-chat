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
// Optional CSP pieces. Each array empties when `init-fork.sh --without-game`
// strips its marker block, which drops those tokens from the policy (see
// scripts/strip-game.mjs). The markers can only DELETE lines, so the
// removable parts live in their own arrays rather than in alternative
// versions of each directive.
const gameScriptSrc = [
  // ── quickdraw-game:start ──
  // The Godot 4 engine (/game/index.wasm) compiles WebAssembly.
  "'wasm-unsafe-eval'",
  // ── quickdraw-game:end ──
];
const gameImgSrc = [
  // ── quickdraw-game:start ──
  // Godot's boot splash is a blob: URL.
  "blob:",
  // ── quickdraw-game:end ──
];
const gameDirectives = [
  // ── quickdraw-game:start ──
  // Godot audio worklets
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  // ── quickdraw-game:end ──
];
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
  directive("script-src 'self' 'unsafe-inline'", ...gameScriptSrc, isDev ? "'unsafe-eval'" : ""),
  // MUI/emotion inject inline <style> tags
  "style-src 'self' 'unsafe-inline'",
  // Same-origin assets + the API (REST + Socket.IO websocket)
  `connect-src 'self' ${apiOrigin} ${apiWsOrigin}`,
  // OAuth avatars come from provider CDNs (Google/Discord) — forks should pin
  // https: to their actual avatar hosts
  directive("img-src 'self' data:", ...gameImgSrc, "https:"),
  "font-src 'self' data:",
  ...gameDirectives,
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
