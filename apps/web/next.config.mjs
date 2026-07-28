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
const cspReportOnly = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': the Godot 4 engine (/game/index.wasm).
  // 'unsafe-inline': Next.js App Router bootstrap scripts (no nonce infra).
  // dev adds 'unsafe-eval' for react-refresh.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  // MUI/emotion inject inline <style> tags
  "style-src 'self' 'unsafe-inline'",
  // Same-origin assets + the API (REST + Socket.IO websocket)
  `connect-src 'self' ${apiOrigin} ${apiWsOrigin}`,
  // blob:: Godot's boot splash. OAuth avatars come from provider CDNs
  // (Google/Discord) — forks should pin https: to their actual avatar hosts
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Godot audio worklets
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// frame-ancestors is ignored in Report-Only mode (per spec), so this one
// directive ships enforced. Deliberately NO X-Frame-Options: the app runs
// inside Discord's Activity iframe, so DENY/SAMEORIGIN would break it —
// this allows exactly the Discord embedding contexts and nothing else.
// Forks without the Discord Activity can trim this to 'self'.
const cspEnforced =
  "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com";

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
  transpilePackages: ["shared"],
  output: "standalone",
  // Monorepo: pin the workspace root explicitly — inference fails under
  // `vercel build` (bun symlink layout) and standalone tracing needs it.
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default nextConfig;
