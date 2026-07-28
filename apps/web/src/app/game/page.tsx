"use client";

import * as React from "react";
import { GameSurface } from "../../components/game";
import { GLOBAL_WORLD_SLUG, type QuickdrawHostConfig } from "@project/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const HOST_CONFIG: QuickdrawHostConfig = {
  apiUrl: API_URL,
  worldSlug: GLOBAL_WORLD_SLUG,
  // Cookie auth: the browser attaches the session cookie to Godot's
  // websocket handshake — no token needed on the plain web route.
  authToken: null,
};

export default function GamePage(): React.ReactElement {
  return <GameSurface hostConfig={HOST_CONFIG} guestFlow guestAuthUrl={`${API_URL}/auth/guest`} />;
}
