"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { GodotCanvas, GameLoading, type GodotLoadState } from "../../components/game";
import { GLOBAL_WORLD_SLUG, type QuickdrawHostConfig } from "@project/shared";

const HOST_CONFIG: QuickdrawHostConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  worldSlug: GLOBAL_WORLD_SLUG,
  // Cookie auth: the browser attaches the session cookie to Godot's
  // websocket handshake — no token needed on the plain web route.
  authToken: null,
};

export default function GamePage(): React.ReactElement {
  const [loadState, setLoadState] = React.useState<GodotLoadState>({
    phase: "loading",
    progress: null,
  });

  return (
    <Box sx={{ position: "relative", height: "calc(100vh - 64px)", overflow: "hidden" }}>
      <GodotCanvas hostConfig={HOST_CONFIG} onStateChange={setLoadState} />
      <GameLoading state={loadState} />
    </Box>
  );
}
