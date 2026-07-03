"use client";

import * as React from "react";
import { Box } from "@mui/material";
import {
  GodotCanvas,
  GameLoading,
  GameHud,
  GameChatOverlay,
  type GodotLoadState,
} from "../../components/game";
import { GLOBAL_WORLD_SLUG, type QuickdrawHostConfig } from "@project/shared";
import { useServiceQuery } from "../../hooks";

const HOST_CONFIG: QuickdrawHostConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  worldSlug: GLOBAL_WORLD_SLUG,
  // Cookie auth: the browser attaches the session cookie to Godot's
  // websocket handshake — no token needed on the plain web route.
  authToken: null,
};

const GET_WORLD_PAYLOAD = { slug: GLOBAL_WORLD_SLUG };

export default function GamePage(): React.ReactElement {
  const [loadState, setLoadState] = React.useState<GodotLoadState>({
    phase: "loading",
    progress: null,
  });
  const ready = loadState.phase === "ready";

  // World metadata (public method) — provides the game chat id
  const { data: world } = useServiceQuery("gameService", "getWorld", GET_WORLD_PAYLOAD);

  return (
    <Box sx={{ position: "relative", height: "calc(100vh - 64px)", overflow: "hidden" }}>
      <GodotCanvas hostConfig={HOST_CONFIG} onStateChange={setLoadState} />
      <GameLoading state={loadState} />
      {/* DOM overlays — mounted once the game has joined the world */}
      {ready && <GameHud />}
      {ready && world?.chatId && <GameChatOverlay chatId={world.chatId} />}
    </Box>
  );
}
