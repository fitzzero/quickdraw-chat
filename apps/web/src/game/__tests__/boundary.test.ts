/**
 * The renderer boundary, as code: only `render/pixi/` imports the engine, so
 * a fork swaps it by replacing that folder; and inside it nothing
 * geometry-shaped is built per frame: textures are generated in textures.ts
 * only, and Graphics are built in textures.ts (once, for the texture) and
 * grid.ts (once per change of the bounds) only.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIXI_DIR = join("render", "pixi");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") sources(path, out);
    } else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const files = sources(GAME_DIR).map((path) => ({
  path: relative(GAME_DIR, path).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

describe("the renderer boundary", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports pixi.js only under render/pixi/", () => {
    const outside = files.filter(
      (f) => !f.path.startsWith(`${PIXI_DIR}/`) && /["']pixi\.js(\/[^"']*)?["']/.test(f.text),
    );
    expect(outside.map((f) => f.path)).toEqual([]);
  });

  it("generates textures in textures.ts only", () => {
    const elsewhere = files.filter(
      (f) => f.path !== `${PIXI_DIR}/textures.ts` && f.text.includes("generateTexture("),
    );
    expect(elsewhere.map((f) => f.path)).toEqual([]);
  });

  it("builds Graphics in textures.ts and grid.ts only, never per frame", () => {
    const allowed = new Set([`${PIXI_DIR}/textures.ts`, `${PIXI_DIR}/grid.ts`]);
    const importsGraphics = (text: string): boolean =>
      /import\s*\{[^}]*\bGraphics\b[^}]*\}\s*from\s*["']pixi\.js["']/.test(text);
    const elsewhere = files.filter(
      (f) =>
        !allowed.has(f.path) &&
        (f.text.includes("new Graphics(") ||
          (importsGraphics(f.text) && f.text.includes(".clear()"))),
    );
    expect(elsewhere.map((f) => f.path)).toEqual([]);
  });
});
