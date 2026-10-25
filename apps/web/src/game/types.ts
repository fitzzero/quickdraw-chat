/** Where the game client is in getting on screen; GameLoading shows it. */
export type GameLoadState =
  | { phase: "loading"; progress: number | null }
  | { phase: "connecting" }
  | { phase: "ready" }
  | { phase: "error"; message: string };
