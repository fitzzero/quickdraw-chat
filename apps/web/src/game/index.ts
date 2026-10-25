/**
 * The game client, for the page: `GameCanvas` loaded on the client only (the
 * renderer touches `window`), and the load state GameLoading shows.
 */

import dynamic from "next/dynamic";

export type { GameLoadState } from "./types";
export type { GameBenchMode } from "./GameCanvas";

export const GameCanvas = dynamic(() => import("./GameCanvas").then((m) => m.GameCanvas), {
  ssr: false,
});
