/**
 * The bots are TS ports of the Godot client, and both read the wire's
 * constants: game_config.gd must name the shared package's, or a port
 * drifts from the server (a Godot food window wider than the server's
 * leaves ghost food, a narrower one asks for keyframes it does not need).
 * game.gd's playback delay must name playback-delay.ts's, or the bench
 * measures a delay the game does not render. snapshot_decoder.gd must read
 * the layout snapshotCodec.ts packs, or Godot misreads every snapshot.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GAME_FOOD_WINDOW,
  GAME_INPUT_FRAMES,
  GAME_TICK_RATE,
  SNAPSHOT_CODEC_VERSION,
  SNAPSHOT_FLAG_KEYFRAME,
  SNAPSHOT_FLAG_T,
  SNAPSHOT_PLAYER_BYTES,
  SNAPSHOT_SPAWNED_BYTES,
} from "@project/shared";
import { describe, expect, it } from "vitest";
import {
  PLAYBACK_DEAD_BAND_MS,
  PLAYBACK_MAX_AHEAD_TICKS,
  PLAYBACK_EWMA_K,
  PLAYBACK_MAX_FRAME_MS,
  PLAYBACK_MAX_LAG_TICKS,
  PLAYBACK_MAX_TICKS,
  PLAYBACK_MIN_TICKS,
  PLAYBACK_SIGMAS,
  PLAYBACK_START_TICKS,
  PLAYBACK_WARP,
} from "./playback-delay.js";
import { MAX_EXTRAPOLATION_TICKS } from "./interpolation.js";

const SCRIPTS = "../../../../game/godot/scripts/";

/** The numeric `const NAME := value` (or `a / b`) declarations of one GDScript file. */
function gdConsts(file: string): (name: string) => number {
  const source = readFileSync(fileURLToPath(new URL(SCRIPTS + file, import.meta.url)), "utf8");
  return (name) => {
    const value = new RegExp(`^const ${name} := ([0-9.]+(?: / [0-9.]+)?)$`, "m").exec(source)?.[1];
    if (value === undefined) throw new Error(`${file} declares no numeric ${name}`);
    const [a, b] = value.split(" / ");
    return b === undefined ? Number(a) : Number(a) / Number(b);
  };
}

describe("the Godot client's constants", () => {
  it("game_config.gd names the wire's constants as the shared package does", () => {
    const gd = gdConsts("game_config.gd");
    expect(gd("TICK_RATE")).toBe(GAME_TICK_RATE);
    expect(gd("INPUT_FRAMES")).toBe(GAME_INPUT_FRAMES);
    expect(gd("FOOD_WINDOW")).toBe(GAME_FOOD_WINDOW);
  });

  it("game.gd's playback delay names playback-delay.ts's constants", () => {
    const gd = gdConsts("autoload/game.gd");
    expect(gd("PLAYBACK_MIN_TICKS")).toBe(PLAYBACK_MIN_TICKS);
    expect(gd("PLAYBACK_MAX_TICKS")).toBe(PLAYBACK_MAX_TICKS);
    expect(gd("PLAYBACK_START_TICKS")).toBe(PLAYBACK_START_TICKS);
    expect(gd("PLAYBACK_WARP")).toBe(PLAYBACK_WARP);
    expect(gd("PLAYBACK_EWMA_K")).toBe(PLAYBACK_EWMA_K);
    expect(gd("PLAYBACK_SIGMAS")).toBe(PLAYBACK_SIGMAS);
    expect(gd("PLAYBACK_DEAD_BAND_MS")).toBe(PLAYBACK_DEAD_BAND_MS);
    expect(gd("PLAYBACK_MAX_LAG_TICKS")).toBe(PLAYBACK_MAX_LAG_TICKS);
    expect(gd("PLAYBACK_MAX_AHEAD_TICKS")).toBe(PLAYBACK_MAX_AHEAD_TICKS);
    expect(gd("PLAYBACK_MAX_FRAME_MS")).toBe(PLAYBACK_MAX_FRAME_MS);
  });

  it("snapshot_decoder.gd reads the layout snapshotCodec.ts packs", () => {
    const gd = gdConsts("snapshot_decoder.gd");
    expect(gd("VERSION")).toBe(SNAPSHOT_CODEC_VERSION);
    expect(gd("FLAG_T")).toBe(SNAPSHOT_FLAG_T);
    expect(gd("FLAG_KEYFRAME")).toBe(SNAPSHOT_FLAG_KEYFRAME);
    expect(gd("PLAYER_BYTES")).toBe(SNAPSHOT_PLAYER_BYTES);
    expect(gd("SPAWNED_BYTES")).toBe(SNAPSHOT_SPAWNED_BYTES);
    expect(gd("FOOD_WINDOW")).toBe(GAME_FOOD_WINDOW);
  });

  it("lets the render clock run ahead by exactly the interpolators' extrapolation budget", () => {
    expect(PLAYBACK_MAX_AHEAD_TICKS).toBe(MAX_EXTRAPOLATION_TICKS);
    expect(gdConsts("remote_snake.gd")("MAX_EXTRAPOLATION_TICKS")).toBe(MAX_EXTRAPOLATION_TICKS);
  });
});
