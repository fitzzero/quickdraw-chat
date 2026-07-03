import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shared"],
  output: "standalone",
  // Monorepo: pin the workspace root explicitly — inference fails under
  // `vercel build` (bun symlink layout) and standalone tracing needs it.
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
};

export default nextConfig;
