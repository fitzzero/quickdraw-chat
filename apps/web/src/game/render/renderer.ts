/**
 * The renderer boundary: what the game shell draws with, and the only part
 * of `apps/web/src/game` that knows an engine. `render/pixi/` implements it
 * with PixiJS; a fork that wants three.js (or anything else) writes another
 * implementation of this interface and swaps one import in GameCanvas: the
 * netcode (`GameClientCore` in the shared package), the frame loop, the
 * input and the page integration do not change. The body-path walk
 * (`bodyPath.ts`), the palette and the spectate camera sit beside this file
 * for the same reason: they are the game's, not the engine's.
 *
 * The one rule every implementation keeps: per-frame work is transform
 * updates only. Nothing geometry-shaped is built in `draw`: no path
 * re-tessellated, no texture generated, no text re-laid out unless its
 * string changed. The engine embed this replaced rebuilt about a thousand
 * circle polygons a frame in immediate-mode draw calls; a port that does
 * the same in another engine gives the same stalls. `stats().geometryBuilds`
 * counts the builds; the client sends it in its bench telemetry, and the
 * browser tier's scorecard gates it (it must sit still after the first
 * second) once the pack's gates child lands.
 */

import type { FoodDTO, GamePlayerMeta, RenderedSnake } from "@project/shared";

/** What the body-path walk and the head need of the world's tunables. */
export interface RenderTunables {
  segmentSpacing: number;
  sampleSpacing: number;
  headRadius: number;
  bodyRadius: number;
}

/** One display frame, as the shell hands it over: where everything is now. */
export interface RenderFrame {
  /** The local snake, as the core rendered it (null while spectating or dead). */
  local: RenderedSnake | null;
  /** The local player's id, so the renderer knows which view is the player's. */
  localId: string | null;
  /** Every remote snake, by player id, at the render tick. */
  remotes: ReadonlyMap<string, RenderedSnake>;
  /** The food held, as of the newest snapshot applied. */
  food: readonly FoodDTO[];
  /** Where the camera looks: the local head, or the spectate target. */
  camera: { x: number; y: number };
  /** Put the camera there at once, without smoothing (the first frame, a spawn). */
  snapCamera: boolean;
  /** Seconds since the client started: the food's pulse. */
  nowS: number;
  deltaS: number;
}

export type RenderBackend = "webgl" | "webgpu";

export interface RendererStats {
  /** The GPU API the engine ended up on (null before mount). */
  backend: RenderBackend | null;
  /** Draw calls in the last frame; null where the backend does not expose them (WebGPU). */
  drawCalls: number | null;
  /**
   * Geometry built (a Graphics drawn) and textures generated since mount:
   * must sit still after the first second. A label laid out for a name is
   * not counted: it is small, and happens once per name.
   */
  geometryBuilds: number;
}

export interface GameRenderer {
  /** Takes over `canvas`, sized to its parent; resolves once a frame can be drawn. */
  mount(canvas: HTMLCanvasElement, options: { preference?: RenderBackend }): Promise<void>;
  /** The canvas's size changed (the shell watches the container). */
  resize(): void;
  /** The world's bounds: the border and the grid, built once per change. */
  setBounds(w: number, h: number): void;
  /** The players' names and hues, as the bootstrap and the events give them. */
  setPlayers(players: Iterable<GamePlayerMeta>): void;
  /** One display frame. */
  draw(frame: RenderFrame): void;
  /** A snake's body history starts over at its head (local_snake.gd reset_path: a hard snap teleported it). */
  resetPath(id: string): void;
  /** The world point under a client (viewport) point: what input aims at. */
  worldPointAt(clientX: number, clientY: number): { x: number; y: number };
  stats(): RendererStats;
  destroy(): void;
}
