/**
 * The bots are TS ports of the Godot client, and both read the wire's
 * constants: game_config.gd must name the shared package's, or a port
 * drifts from the server (a Godot food window wider than the server's
 * leaves ghost food, a narrower one asks for keyframes it does not need).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GAME_FOOD_WINDOW, GAME_INPUT_FRAMES, GAME_TICK_RATE } from "@project/shared";
import { describe, expect, it } from "vitest";

const config = readFileSync(
  fileURLToPath(new URL("../../../../game/godot/scripts/game_config.gd", import.meta.url)),
  "utf8",
);

/** A numeric `const NAME := value` of game_config.gd. */
function gdConst(name: string): number {
  const value = new RegExp(`^const ${name} := ([0-9.]+)$`, "m").exec(config)?.[1];
  if (value === undefined) throw new Error(`game_config.gd declares no numeric ${name}`);
  return Number(value);
}

describe("game_config.gd", () => {
  it("names the wire's constants as the shared package does", () => {
    expect(gdConst("TICK_RATE")).toBe(GAME_TICK_RATE);
    expect(gdConst("INPUT_FRAMES")).toBe(GAME_INPUT_FRAMES);
    expect(gdConst("FOOD_WINDOW")).toBe(GAME_FOOD_WINDOW);
  });
});
