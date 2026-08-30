import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const req = createRequire(import.meta.url);

/** Resolve an addon/framework to its real path (bun symlinks workspace deps). */
function getAbsolutePath(value: string): string {
  return dirname(req.resolve(join(value, "package.json")));
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx", "../src/stories/**/*.mdx"],
  addons: [getAbsolutePath("@storybook/addon-docs"), getAbsolutePath("@storybook/addon-a11y")],
  framework: {
    name: getAbsolutePath("@storybook/nextjs-vite") as "@storybook/nextjs-vite",
    options: {},
  },
  staticDirs: ["../public"],
  // Forks inherit this CI gate; keep the build free of network calls
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => {
    // bun installs workspace deps as symlinks outside apps/web; widen the
    // dev-server file allowlist to the repo root so they can be served
    viteConfig.server = {
      ...viteConfig.server,
      fs: { ...viteConfig.server?.fs, allow: [repoRoot] },
    };
    // Socket-tier stories: the real QuickdrawProvider runs over a fake socket
    // (see src/stories/mock-socket-io.ts) instead of a live server. The core
    // client must stay out of dep pre-bundling or esbuild resolves the real
    // socket.io-client before the alias can apply.
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...viteConfig.resolve?.alias,
        "socket.io-client": resolve(repoRoot, "apps/web/src/stories/mock-socket-io.ts"),
      },
    };
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      exclude: [...(viteConfig.optimizeDeps?.exclude ?? []), "@fitzzero/quickdraw-core"],
    };
    return viteConfig;
  },
};

export default config;
