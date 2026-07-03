"use client";

import * as React from "react";
import { Box } from "@mui/material";
import type { QuickdrawHostConfig } from "@project/shared";

export type GodotLoadState =
  | { phase: "loading"; progress: number | null }
  | { phase: "connecting" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

interface GodotCanvasProps {
  /** Written to window.QuickdrawHost BEFORE the engine boots. */
  hostConfig: QuickdrawHostConfig;
  onStateChange?: (state: GodotLoadState) => void;
}

/**
 * Direct-embed Godot canvas (no iframe): loads the exported engine script,
 * boots it against our own <canvas>, and reports load progress. Direct embed
 * is what lets MUI overlays float above the game and lets Discord's path
 * proxy rewrite asset URLs without an extra document.
 *
 * Flow: set QuickdrawHost → load /game/index.js → new Engine(engine-config)
 * → startGame(onProgress) → Godot dispatches window "godot:ready" once the
 * player has joined the world (see net.gd notify_web_ready).
 */
export function GodotCanvas({ hostConfig, onStateChange }: GodotCanvasProps): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const stateChangeRef = React.useRef(onStateChange);
  stateChangeRef.current = onStateChange;

  React.useEffect(() => {
    if (!canvasRef.current) return () => undefined;

    const canvas = canvasRef.current;
    const emit = (state: GodotLoadState) => stateChangeRef.current?.(state);
    let engine: GodotEngine | null = null;
    let cancelled = false;

    const handleReady = () => emit({ phase: "ready" });
    window.addEventListener("godot:ready", handleReady);

    async function boot(): Promise<void> {
      emit({ phase: "loading", progress: 0 });
      window.QuickdrawHost = hostConfig;

      const configResponse = await fetch("/game/engine-config.json");
      if (!configResponse.ok) {
        throw new Error("Game build missing — run `bun run export` in apps/game");
      }
      const engineConfig = (await configResponse.json()) as Record<string, unknown>;

      if (!window.Engine) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/game/index.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load game engine script"));
          document.head.appendChild(script);
        });
      }
      if (cancelled) return;

      engine = new window.Engine({
        ...engineConfig,
        canvas,
        executable: "/game/index",
        onProgress: (current: number, total: number) => {
          emit({ phase: "loading", progress: total > 0 ? current / total : null });
        },
      });

      await engine.startGame();
      if (!cancelled) emit({ phase: "connecting" });
    }

    // Deferred boot: React StrictMode mounts, unmounts, and remounts effects
    // in dev. The throwaway first mount clears this timer before it fires, so
    // only the surviving mount actually boots the engine.
    const bootTimer = window.setTimeout(() => {
      boot().catch((error: unknown) => {
        if (!cancelled) {
          emit({
            phase: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
      window.removeEventListener("godot:ready", handleReady);
      try {
        engine?.requestQuit();
      } catch {
        // Engine may not have finished booting; nothing to clean up.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot exactly once
  }, []);

  return (
    <Box sx={{ position: "absolute", inset: 0, bgcolor: "#14171e" }}>
      <Box
        component="canvas"
        ref={canvasRef}
        id="godot-canvas"
        tabIndex={0}
        sx={{ width: "100%", height: "100%", display: "block", outline: "none" }}
      />
    </Box>
  );
}
