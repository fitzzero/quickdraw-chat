"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { useRouter } from "next/navigation";
import {
  GLOBAL_WORLD_ID,
  GLOBAL_WORLD_SLUG,
  type GameDeathEvent,
  type HighScoreEntry,
  type QuickdrawHostConfig,
} from "@project/shared";
import { GodotCanvas, type GodotLoadState } from "./GodotCanvas";
import { GameLoading } from "./GameLoading";
import { GameHud } from "./GameHud";
import { GameChatOverlay } from "./GameChatOverlay";
import { qd, useQuickdraw } from "../../lib/quickdraw";
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
const TOP_SCORES_PAYLOAD = { worldId: GLOBAL_WORLD_ID, limit: 5 };

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
          {/* Keyed by user: creating a guest session must reboot the engine
              so its websocket handshake carries the new cookie */}
          <GodotCanvas
            key={session.canvasKey}
            hostConfig={hostConfig}
            onStateChange={session.setLoadState}
          />
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
  canvasKey: string;
  showHud: boolean;
  chatId: string | null;
  dialog: React.ReactElement | null;
}

// oxlint-disable-next-line max-lines-per-function -- one cohesive state machine
function useGameSession(guestFlow: boolean, guestAuthUrl?: string): GameSession {
  const router = useRouter();
  // quickdraw-5.0 finding: useQuickdraw() hydrates from the live connection (useSyncExternalStore's server snapshot is getState), so under this page's Suspense boundary, which hydrates after the provider's effects connected, a signed-in user renders the Start button where the server rendered the guest form: "Hydration failed", the tree regenerated on the client
  const { userId, isConnected, connection } = useQuickdraw();

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

  const { data: world } = qd.gameService.getWorld.useQuery(GET_WORLD_PAYLOAD);

  // Personal best, and the all-time top runs shown inside the dialog
  // (public — works signed-out too); both are read again when a stored score
  // changes (scoreSaved, below)
  const { data: myBest } = qd.gameService.getMyBest.useQuery(WORLD_PAYLOAD, {
    enabled: !!userId,
  });
  const { data: topScores } = qd.gameService.getHighScores.useQuery(TOP_SCORES_PAYLOAD);

  // This page's socket in the world's room: the world's events reach the
  // page (deaths here, the leaderboard in the HUD), and it anchors the player
  useWorldRoom();

  // Death detection: the same reliable world events Godot consumes
  qd.gameService.death.useEvent((event) => {
    if (event.id === userId) setDeath(event);
  });
  // quickdraw-5.0 finding: a query over a model no service owns (GameScore, which gameService only `writes`) can declare no watch: a watch names a collection scope or a service topic, and a write to a `writes` model signals neither, so the server sends its own scoreSaved event and the page invalidates by hand
  qd.gameService.scoreSaved.useEvent((saved) => {
    qd.invalidate(qd.gameService.getHighScores);
    if (saved.userId === userId) qd.invalidate(qd.gameService.getMyBest);
  });

  const joinGame = qd.gameService.joinGame.useMutation({
    onSuccess: () => {
      setHasJoined(true);
      setDeath(null);
      focusCanvas();
    },
  });
  const respawn = qd.gameService.respawn.useMutation({
    onSuccess: () => {
      setDeath(null);
      focusCanvas();
    },
  });

  // The guest socket cycle doesn't remount this component (public route), so
  // clear the in-flight guest flag once the new session lands
  React.useEffect(() => {
    if (userId) setCreatingGuest(false);
  }, [userId]);

  // Resume after the guest socket cycle (the canvas is keyed by user and
  // reboots with the new cookie) or a mid-game reload
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
    // A fresh handshake carries the new cookie
    connection.close();
    connection.open();
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
    topScores,
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
    // Guest surfaces boot straight into anonymous spectate; authed surfaces
    // (Discord Activity) wait for their token auth
    bootCanvas: guestFlow || !!userId,
    canvasKey: userId ?? "spectator",
    showHud: ready,
    // Membership is granted by watchWorld (Godot's spectate boot), so the
    // chat overlay works behind the pre-game dialog, not just after joining
    chatId: ready && userId ? (world?.chatId ?? null) : null,
    dialog,
  };
}

/**
 * Puts this page's socket in the world's room (watchWorld, which spectating
 * needs anyway: public, so signed-out visitors too), on every connection:
 * after a reconnect the new socket is in no room until a call joins it again.
 */
// quickdraw-5.0 finding: the typed client has no way to say "run this joining call on every connection": a room joined through a query is lost on reconnect (the client refetches only watched or stale queries, and the query's cached answer still looks fine), so the page re-calls watchWorld whenever a new hello arrives
function useWorldRoom(): void {
  const { hello } = useQuickdraw();
  React.useEffect(() => {
    if (hello === null) return;
    qd.gameService.watchWorld.call(WORLD_PAYLOAD).catch(() => {
      // The next connection's hello tries again
    });
  }, [hello]);
}

interface DialogInputs {
  hasJoined: boolean;
  death: GameDeathEvent | null;
  userId: string | null;
  bestLength: number | undefined;
  topScores: HighScoreEntry[] | undefined;
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
      topScores={inputs.topScores ?? []}
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
