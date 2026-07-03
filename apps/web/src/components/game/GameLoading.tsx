"use client";

import * as React from "react";
import { Box, CircularProgress, Fade, LinearProgress, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSlowLoadHint } from "../../hooks";
import type { GodotLoadState } from "./GodotCanvas";

interface GameLoadingProps {
  state: GodotLoadState;
}

/**
 * DOM loading overlay above the Godot canvas: engine download progress →
 * connecting → fades out when the game reports ready. The wrapper owning
 * loading UI (instead of Godot's built-in splash) is the template's
 * "web wrapper does the heavy lifting" pattern.
 */
export function GameLoading({ state }: GameLoadingProps): React.ReactElement {
  const t = useTranslations("GamePage");
  const tCommon = useTranslations("Common");
  const visible = state.phase !== "ready";
  // The engine's socket waits on the same API — a long connect is (in
  // production) a Cloud Run cold start. The wasm "loading" phase is CDN
  // download, so the hint only keys on "connecting".
  const showWarmingHint = useSlowLoadHint(state.phase === "connecting");

  return (
    <Fade in={visible} timeout={600} unmountOnExit>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          bgcolor: "#14171e",
          zIndex: (theme) => theme.zIndex.modal,
        }}
      >
        <Typography variant="h5" color="common.white">
          {t("title")}
        </Typography>

        {state.phase === "loading" && (
          <Box sx={{ width: 280, display: "flex", flexDirection: "column", gap: 1 }}>
            <LinearProgress
              variant={state.progress === null ? "indeterminate" : "determinate"}
              value={(state.progress ?? 0) * 100}
            />
            <Typography variant="body2" color="grey.500" textAlign="center">
              {t("loadingEngine")}
            </Typography>
          </Box>
        )}

        {state.phase === "connecting" && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="grey.500">
                {t("connecting")}
              </Typography>
            </Box>
            <Fade in={showWarmingHint}>
              <Typography variant="caption" color="grey.600">
                {tCommon("warmingUp")}
              </Typography>
            </Fade>
          </Box>
        )}

        {state.phase === "error" && (
          <Typography variant="body2" color="error" sx={{ maxWidth: 420, textAlign: "center" }}>
            {state.message}
          </Typography>
        )}
      </Box>
    </Fade>
  );
}
