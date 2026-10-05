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
    // Components render over quickdraw's mock client: every import of the
    // app's client module (`../lib/quickdraw`, at any depth) resolves to
    // src/stories/quickdraw.tsx, whose `qd` is createMockClient's. No socket,
    // no server; stories set what the hooks show (see that file), and the
    // real useQuickdraw() reads the mock's session under qd.$Provider.
    const existing = viteConfig.resolve?.alias;
    const aliases = Array.isArray(existing)
      ? existing
      : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        ...aliases,
        {
          find: /^(?:\.\.\/)+lib\/quickdraw$/,
          replacement: resolve(repoRoot, "apps/web/src/stories/quickdraw.tsx"),
        },
      ],
    };
    return viteConfig;
  },
};

export default config;
