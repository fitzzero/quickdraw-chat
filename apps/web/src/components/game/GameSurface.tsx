"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { useRouter } from "next/navigation";
import {
  GAME_EVENTS,
  GLOBAL_WORLD_ID,
  GLOBAL_WORLD_SLUG,
  type GameDeathEvent,
  type QuickdrawHostConfig,
} from "@project/shared";
import { useRoomEvents, useService, useServiceQuery, useSubscription } from "../../hooks";
import { useSocket } from "../../providers";
import { GodotCanvas, type GodotLoadState } from "./GodotCanvas";
import { GameLoading } from "./GameLoading";
import { GameHud } from "./GameHud";
import { GameChatOverlay } from "./GameChatOverlay";
import { PreGameDialog } from "./PreGameDialog";

/** Survives the socket cycle (AuthGate remounts the page) and full reloads. */
const PENDING_START_KEY = "game:pendingStart";
const RETURN_TO_KEY = "returnTo";

interface GameSurfaceProps {
  /** Written to window.QuickdrawHost before the engine boots. */
  hostConfig: QuickdrawHostConfig;
  /** Offer the signed-out guest flow (off inside the Discord Activity). */
  guestFlow: boolean;
  /** Guest session endpoint (absolute or proxy-relative). */
  guestAuthUrl?: string;
}

const GET_WORLD_PAYLOAD = { slug: GLOBAL_WORLD_SLUG };
const WORLD_PAYLOAD = { worldId: GLOBAL_WORLD_ID };

/**
 * The full game surface: Godot canvas + every DOM overlay (loading, pre-game
 * dialog, HUD, chat). Shared by /game and the Discord Activity shell.
 *
 * The dialog is the template's showcase: the game world runs in Godot
 * (spectate boot via watchWorld), while Start/Respawn are ordinary quickdraw
 * method calls from THIS React component's socket — the Godot client notices
 * the spawn in the next snapshot. Web components and the game engine drive
 * one shared, ACL'd game state through the same typed API.
 */
export function GameSurface({
  hostConfig,
  guestFlow,
  guestAuthUrl,
}: GameSurfaceProps): React.ReactElement {
  const session = useGameSession(guestFlow, guestAuthUrl);

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {session.bootCanvas ? (
        <>
          <GodotCanvas hostConfig={hostConfig} onStateChange={session.setLoadState} />
          <GameLoading state={session.loadState} />
        </>
      ) : (
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "#14171e" }} />
      )}

      {session.showHud && <GameHud />}
      {session.chatId && <GameChatOverlay chatId={session.chatId} />}
      {session.dialog}
    </Box>
  );
}

interface GameSession {
  loadState: GodotLoadState;
  setLoadState: (state: GodotLoadState) => void;
  bootCanvas: boolean;
  showHud: boolean;
  chatId: string | null;
  dialog: React.ReactElement | null;
}

// oxlint-disable-next-line max-lines-per-function -- one cohesive state machine
function useGameSession(guestFlow: boolean, guestAuthUrl?: string): GameSession {
  const router = useRouter();
  const { userId, isConnected, connect, disconnect } = useSocket();

  const [loadState, setLoadState] = React.useState<GodotLoadState>({
    phase: "loading",
    progress: null,
  });
  const [hasJoined, setHasJoined] = React.useState(false);
  const [death, setDeath] = React.useState<GameDeathEvent | null>(null);
  const [creatingGuest, setCreatingGuest] = React.useState(false);

  const ready = loadState.phase === "ready";
  // Guests get the engine only once their session exists (the cookie must
  // ride Godot's websocket handshake) — bootCanvas below keys on userId.
  const needsGuest = guestFlow && !userId;

  const { data: world } = useServiceQuery("gameService", "getWorld", GET_WORLD_PAYLOAD);

  // Personal best — refreshed automatically when a death lands
  const { data: myBest } = useServiceQuery("gameService", "getMyBest", WORLD_PAYLOAD, {
    enabled: !!userId,
    invalidateOn: [GAME_EVENTS.death],
  });

  // Death detection on the page socket: world-room membership + the reliable
  // death stream (the same events Godot consumes)
  useSubscription("gameService", GLOBAL_WORLD_ID, { enabled: !!userId });
  useRoomEvents({
    [GAME_EVENTS.death]: (event: GameDeathEvent) => {
      if (event.id === userId) setDeath(event);
    },
  });

  const joinGame = useService("gameService", "joinGame", {
    onSuccess: () => {
      setHasJoined(true);
      setDeath(null);
      focusCanvas();
    },
  });
  const respawn = useService("gameService", "respawn", {
    onSuccess: () => {
      setDeath(null);
      focusCanvas();
    },
  });

  // Resume after the guest socket cycle (AuthGate remounts this component
  // when the socket reconnects with the new cookie) or a mid-game reload
  React.useEffect(() => {
    if (ready && userId && !hasJoined && sessionStorage.getItem(PENDING_START_KEY)) {
      sessionStorage.removeItem(PENDING_START_KEY);
      joinGame.mutate(WORLD_PAYLOAD);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on readiness edges only
  }, [ready, userId, hasJoined]);

  // Reconnect nicety: a socket blip while playing re-anchors the player.
  // Never while the death dialog is open — joinGame revives dead players.
  const wasConnectedRef = React.useRef(isConnected);
  React.useEffect(() => {
    const cameBack = isConnected && !wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (cameBack && hasJoined && !death) {
      joinGame.mutate(WORLD_PAYLOAD);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edge-triggered
  }, [isConnected]);

  const handleStart = (guestName?: string): void => {
    if (needsGuest && guestName) {
      void createGuestAndReconnect(guestName);
      return;
    }
    joinGame.mutate(WORLD_PAYLOAD);
  };

  async function createGuestAndReconnect(name: string): Promise<void> {
    if (!guestAuthUrl) return;
    setCreatingGuest(true);
    const created = await createGuestSession(guestAuthUrl, name);
    if (!created) {
      setCreatingGuest(false);
      return;
    }
    // The new session cookie only applies to a fresh handshake. AuthGate
    // remounts the page during the cycle, so the resume flag carries the
    // "start the game" intent across the remount.
    sessionStorage.setItem(PENDING_START_KEY, "1");
    disconnect();
    connect();
  }

  const handleLogin = (): void => {
    sessionStorage.setItem(RETURN_TO_KEY, "/game");
    router.push("/auth/login");
  };

  const dialog = buildDialog({
    hasJoined,
    death,
    userId,
    bestLength: myBest?.bestLength,
    ready,
    needsGuest,
    starting: creatingGuest || joinGame.isPending || respawn.isPending,
    onRespawn: () => respawn.mutate(WORLD_PAYLOAD),
    onStart: handleStart,
    onLogin: handleLogin,
  });

  return {
    loadState,
    setLoadState,
    bootCanvas: !!userId,
    showHud: ready && !!userId,
    chatId: hasJoined ? (world?.chatId ?? null) : null,
    dialog,
  };
}

interface DialogInputs {
  hasJoined: boolean;
  death: GameDeathEvent | null;
  userId: string | null;
  bestLength: number | undefined;
  ready: boolean;
  needsGuest: boolean;
  starting: boolean;
  onRespawn: () => void;
  onStart: (guestName?: string) => void;
  onLogin: () => void;
}

function buildDialog(inputs: DialogInputs): React.ReactElement | null {
  if (inputs.hasJoined && inputs.death === null) return null;
  const dead = inputs.death !== null;
  return (
    <PreGameDialog
      mode={dead ? "dead" : "start"}
      lastRunLength={inputs.death?.len}
      bestLength={inputs.userId ? (inputs.bestLength ?? 0) : undefined}
      canStart={inputs.needsGuest ? true : inputs.ready}
      starting={inputs.starting}
      needsGuest={inputs.needsGuest}
      onStart={dead ? inputs.onRespawn : inputs.onStart}
      onLogin={inputs.onLogin}
    />
  );
}

function focusCanvas(): void {
  document.getElementById("godot-canvas")?.focus();
}

async function createGuestSession(url: string, name: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
