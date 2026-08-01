/**
 * PWA integration pins — static assertions over the files that make the app
 * installable and push-capable. These catch the silent regressions (manifest
 * field dropped, SW handler renamed, cache header removed) that no unit test
 * would notice and no reviewer reliably spots.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(webRoot, "public");

function read(relPath: string): string {
  return readFileSync(path.join(webRoot, relPath), "utf8");
}

describe("PWA", () => {
  it("has a valid installable web app manifest", () => {
    const manifest = JSON.parse(read("public/site.webmanifest")) as Record<string, unknown>;

    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();

    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose?.includes("maskable"))).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("ships every icon the manifest and metadata reference", () => {
    for (const icon of [
      "web-app-manifest-192x192.png",
      "web-app-manifest-512x512.png",
      "apple-touch-icon.png",
      "favicon-96x96.png",
      "favicon.ico",
      "favicon.svg",
    ]) {
      expect(existsSync(path.join(publicDir, icon)), `missing public/${icon}`).toBe(true);
    }
  });

  it("has a service worker with the full handler set", () => {
    const sw = read("public/sw.js");

    // Installability + lifecycle
    expect(sw).toContain("skipWaiting");
    expect(sw).toContain("clients.claim");
    expect(sw).toContain('addEventListener("fetch"');
    // Push pipeline
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain('addEventListener("pushsubscriptionchange"');
    expect(sw).toContain("/api/push/resubscribe");
  });

  it("registers the service worker from the provider tree", () => {
    expect(read("src/providers/index.tsx")).toContain("useServiceWorker(");
  });

  it("declares standalone metadata without iOS translucent-status-bar quirks", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('manifest: "/site.webmanifest"');
    expect(layout).toContain("appleWebApp");
    // "black-translucent" shifts iOS fixed-position origins by the top inset
    expect(layout).toContain('statusBarStyle: "black"');
    expect(layout).not.toContain('statusBarStyle: "black-translucent"');
  });

  it("serves sw.js with a no-cache header so updates roll out", () => {
    const config = read("next.config.mjs");
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("no-cache, no-store, must-revalidate");
  });
});
