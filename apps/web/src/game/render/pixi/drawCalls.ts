/**
 * Counts a frame's draw calls on WebGL by wrapping the context's draw
 * functions: the gate reads them (`RendererStats.drawCalls`). WebGPU
 * exposes no cheap equivalent, so there the count is null and the gate
 * reads frame time and long tasks alone.
 */

import { RendererType, type Renderer, type WebGLRenderer } from "pixi.js";
import type { RenderBackend } from "../renderer";

export interface DrawCallCounter {
  readonly backend: RenderBackend | null;
  /** A frame starts. */
  begin(): void;
  /** A frame ended: its draw calls, or null where they are not counted. */
  end(): number | null;
}

const DRAW_FUNCTIONS = [
  "drawElements",
  "drawArrays",
  "drawElementsInstanced",
  "drawArraysInstanced",
] as const;

export function installDrawCallCounter(renderer: Renderer): DrawCallCounter {
  if (renderer.type === RendererType.WEBGPU) {
    return { backend: "webgpu", begin: () => undefined, end: () => null };
  }
  if (renderer.type !== RendererType.WEBGL) {
    return { backend: null, begin: () => undefined, end: () => null };
  }
  const gl = (renderer as WebGLRenderer).gl as unknown as Record<string, unknown>;
  const counter = { count: 0 };
  for (const name of DRAW_FUNCTIONS) wrapDraw(gl, name, counter);
  return {
    backend: "webgl",
    begin: () => {
      counter.count = 0;
    },
    end: () => counter.count,
  };
}

/** Counts each call of the context's `name` draw function in `counter`. */
function wrapDraw(gl: Record<string, unknown>, name: string, counter: { count: number }): void {
  const original = gl[name];
  if (typeof original !== "function") return;
  const draw = original as (...args: unknown[]) => unknown;
  gl[name] = (...args: unknown[]): unknown => {
    counter.count += 1;
    return draw.apply(gl, args);
  };
}
