/**
 * Minimal typing for Godot's web export Engine loader (/game/index.js).
 * The full config shape ships as /game/engine-config.json, extracted from
 * the export by apps/game/export-web.sh.
 */

interface GodotEngineConfig {
  canvas?: HTMLCanvasElement;
  executable?: string;
  args?: string[];
  canvasResizePolicy?: number;
  focusCanvas?: boolean;
  fileSizes?: Record<string, number>;
  onProgress?: (current: number, total: number) => void;
  [key: string]: unknown;
}

declare class GodotEngine {
  constructor(config: GodotEngineConfig);
  startGame(override?: GodotEngineConfig): Promise<void>;
  requestQuit(): void;
}

interface Window {
  Engine: typeof GodotEngine;
  QuickdrawHost?: import("@project/shared").QuickdrawHostConfig;
}
