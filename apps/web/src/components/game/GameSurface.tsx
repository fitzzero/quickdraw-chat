"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { useRouter } from "next/navigation";
import type { QuickdrawError } from "@fitzzero/quickdraw-core";
import { useJoin, useQuickdraw, type UseJoinResult } from "@fitzzero/quickdraw-core/client";
import {
  GLOBAL_WORLD_ID,
  GLOBAL_WORLD_SLUG,
  type GameDeathEvent,
  type HighScoreEntry,
  type QuickdrawHostConfig,
  type WorldBootstrap,
} from "@project/shared";
import { GameCanvas, type GameLoadState } from "../../game";
import { GodotCanvas } from "./GodotCanvas";
import { GameLoading } from "./GameLoading";
import { GameHud } from "./GameHud";
import { GameChatOverlay } from "./GameChatOverlay";
import { qd } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";
import { PreGameDialog } from "./PreGameDialog";
import { useParty, type PartySession, type PartyState } from "./useParty";

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
  /**
   * A party's host lags its own user's links to its players' median one-way
   * trip (`?fairLink=off` on /game turns it off, for A/B play). Default on.
   */
  fairLink?: boolean;
}

const GET_WORLD_PAYLOAD = { slug: GLOBAL_WORLD_SLUG };
const WORLD_PAYLOAD = { worldId: GLOBAL_WORLD_ID };
const TOP_SCORES_PAYLOAD = { worldId: GLOBAL_WORLD_ID, limit: 5 };

/**
 * The full game surface: the game canvas + every DOM overlay (loading,
 * pre-game dialog, HUD, chat). Shared by /game and the Discord Activity
 * shell.
 *
 * The dialog is the template's showcase: the world is drawn by the page's
 * own game client (apps/web/src/game: the shared netcode core under a
 * PixiJS renderer) on this component's socket, which `useJoin` puts in the
 * world's room (watchWorld: spectate), while Start/Respawn are an ordinary
 * quickdraw method call (joinGame, joined again on every connection) — the
 * client notices the spawn in the next snapshot. Web components and the
 * game client drive one shared, ACL'd game state through the same typed API.
 *
 * A party (host mode) is the same surface over another world: the dialog
 * hosts one (this page then runs its world, usePartyHost) or joins one by
 * its code. A party still boots the Godot embed (QuickdrawHost.party) until
 * the TypeScript client plays parties too.
 */
export function GameSurface({
  hostConfig,
  guestFlow,
  guestAuthUrl,
  fairLink = true,
}: GameSurfaceProps): React.ReactElement {
  const session = useGameSession(guestFlow, guestAuthUrl, fairLink);
  const partyCode = session.party.party?.code ?? null;
  // the engine reads it once, at boot: entering or leaving a party boots it again
  const engineConfig = React.useMemo<QuickdrawHostConfig>(
    () => ({ ...hostConfig, party: partyCode === null ? null : { code: partyCode } }),
    [hostConfig, partyCode],
  );

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {session.bootCanvas ? (
        <>
          {/* Keyed by user: creating a guest session must reboot the engine
              so its websocket handshake carries the new cookie, and a
              party is another world to join */}
          {partyCode === null ? (
            <GameCanvas
              key={session.canvasKey}
              bootstrap={session.bootstrap}
              onStateChange={session.setLoadState}
            />
          ) : (
            // a party still plays in the Godot embed until the TypeScript
            // client plays parties too
            <GodotCanvas
              key={session.canvasKey}
              hostConfig={engineConfig}
              onStateChange={session.setLoadState}
            />
          )}
          <GameLoading state={session.loadState} />
        </>
      ) : (
        <Box sx={{ position: "absolute", inset: 0, bgcolor: "#14171e" }} />
      )}

      {session.showHud && (
        <GameHud
          party={
            session.party.party === null ? undefined : { leaderboard: session.party.leaderboard }
          }
        />
      )}
      {session.chatId && (
        <GameChatOverlay chatId={session.chatId} {...(partyCode === null ? {} : { partyCode })} />
      )}
      {session.dialog}
    </Box>
  );
}

/** The server's world, as a run's world: a party's is its world id. */
const WORLD_KEY = "world";

/** A run: the world the user asked to play in, and their last death there. */
interface Run {
  readonly world: string;
  readonly death: GameDeathEvent | null;
}

/** The world the page shows (a party's, or the server's), and the run there. */
function runOf(
  run: Run | null,
  partyWorldId: string | null,
): { worldKey: string; playing: boolean; death: GameDeathEvent | null } {
  const worldKey = partyWorldId ?? WORLD_KEY;
  const playing = run?.world === worldKey;
  return { worldKey, playing, death: playing ? (run?.death ?? null) : null };
}

interface GameSession {
  loadState: GameLoadState;
  setLoadState: (state: GameLoadState) => void;
  /** The world the page's watchWorld join answered; the game client draws from here. */
  bootstrap: WorldBootstrap | null;
  bootCanvas: boolean;
  canvasKey: string;
  showHud: boolean;
  chatId: string | null;
  dialog: React.ReactElement | null;
  party: PartySession;
}

// oxlint-disable-next-line max-lines-per-function -- one cohesive state machine
function useGameSession(
  guestFlow: boolean,
  guestAuthUrl: string | undefined,
  fairLink: boolean,
): GameSession {
  const router = useRouter();
  const errorText = useErrorText();
  const { userId, connection } = useQuickdraw();

  const [loadState, setLoadState] = React.useState<GameLoadState>({
    phase: "loading",
    progress: null,
  });
  // The world the user asked to play in (Start, or a start that outlived the
  // guest socket cycle or a reload) and their last death there
  const [run, setRun] = React.useState<Run | null>(null);
  const [creatingGuest, setCreatingGuest] = React.useState(false);

  const ready = loadState.phase === "ready";
  // Guests get the client only once their session exists (the canvas is
  // keyed by user, so the game starts over as them) — bootCanvas below
  // keys on userId.
  const needsGuest = guestFlow && !userId;

  // A party the page hosts or joined: its own world, deaths and leaderboard
  const partySession = useParty({ onDeath: (event) => setDeath(event), fairLink });
  const party = partySession.party;
  const inParty = party !== null;
  const partyWorldId = party?.worldId ?? null;
  // A party is another world: its dialog starts again at Start, in the
  // render that enters or leaves it (no join of one world runs for another)
  const { worldKey, playing, death } = runOf(run, partyWorldId);
  const setPlaying = (): void => setRun({ world: worldKey, death: null });
  function setDeath(event: GameDeathEvent | null): void {
    setRun((current) => (current?.world === worldKey ? { ...current, death: event } : current));
  }

  const { data: world } = qd.gameService.getWorld.useQuery(GET_WORLD_PAYLOAD);

  // Personal best, and the all-time top runs shown inside the dialog
  // (public — works signed-out too); both watch the game's service topic
  // narrowed to the scores (`watch: { service: ["gameScore"] }`), so a
  // stored score reads them again
  const { data: myBest } = qd.gameService.getMyBest.useQuery(WORLD_PAYLOAD, {
    enabled: !!userId,
  });
  const { data: topScores } = qd.gameService.getHighScores.useQuery(TOP_SCORES_PAYLOAD);

  // This page's socket in the world's room, on every connection (a new
  // socket is in no room until a call joins it): the world's events reach
  // the page (deaths here, the leaderboard in the HUD), and its bootstrap
  // (the bounds, the players' names) is the game client's. watchWorld is
  // public, so signed-out visitors spectate too. Not in a party: its host
  // sends the party's
  const watch = useJoin(qd.gameService.watchWorld, WORLD_PAYLOAD, { enabled: !inParty });

  const { playJoin, hasJoined, joinError } = usePlayer({
    alive: playing && death === null && userId !== null,
    playing,
    worldId: partyWorldId,
  });

  // Death detection: the same reliable world events the game client hears
  // (a party's come from its host, useParty)
  qd.gameService.death.useEvent((event) => {
    if (event.id === userId && !inParty) setDeath(event);
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
      setRun({ world: WORLD_KEY, death: null });
    }
  }, [ready, userId, hasJoined]);

  const handleStart = (guestName?: string): void => {
    if (needsGuest && guestName) {
      void createGuestAndReconnect(guestName);
      return;
    }
    if (joinError === null) setPlaying();
    else playJoin.retry();
  };

  async function createGuestAndReconnect(name: string): Promise<void> {
    if (!guestAuthUrl) return;
    setCreatingGuest(true);
    const created = await createGuestSession(guestAuthUrl, name);
    if (!created) {
      setCreatingGuest(false);
      return;
    }
    // The new session cookie only applies to a fresh handshake; the resume
    // flag carries the "start the game" intent across the socket cycle (and
    // the canvas's reboot as the new user)
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
    starting: creatingGuest || playJoin.status === "joining",
    joinError: joinError === null ? undefined : errorText(joinError),
    party: partySession,
    // the join runs again: joinGame spawns the dead player's snake
    onRespawn: () => {
      setDeath(null);
    },
    onStart: handleStart,
    onLogin: handleLogin,
  });

  return {
    loadState,
    setLoadState,
    bootstrap: watch.data ?? null,
    // Guest surfaces boot straight into anonymous spectate; authed surfaces
    // (Discord Activity) wait for their token auth
    bootCanvas: guestFlow || !!userId,
    canvasKey: `${userId ?? "spectator"}:${worldKey}`,
    showHud: ready,
    chatId: ready && userId ? chatOf(party, world?.chatId) : null,
    dialog,
    party: partySession,
  };
}

interface Player {
  /** The join that spawns the player: joinGame, or a party's playParty. */
  playJoin: UseJoinResult<unknown>;
  /** The player's snake was asked for (the dialog closes). */
  hasJoined: boolean;
  /** Why the current socket's join was refused; null otherwise. */
  joinError: QuickdrawError | null;
}

/**
 * The player: joinGame over this socket once the user plays, and again on
 * every connection while they are alive (a socket blip, or a new world
 * after a server restart), which anchors the player in the world's room.
 * Not while the death dialog is open: joinGame spawns a dead player's
 * snake, which is what Respawn lets it do. In a party (`worldId`),
 * playParty instead: the server tells the party's host, which spawns the
 * snake, again after a death.
 */
function usePlayer({
  alive,
  playing,
  worldId,
}: {
  alive: boolean;
  playing: boolean;
  worldId: string | null;
}): Player {
  const world = useJoin(qd.gameService.joinGame, WORLD_PAYLOAD, {
    enabled: alive && worldId === null,
    onJoined: focusCanvas,
  });
  const party = useJoin(
    qd.gameService.playParty,
    { worldId: worldId ?? "" },
    { enabled: alive && worldId !== null, onJoined: focusCanvas },
  );
  const playJoin = worldId === null ? world : party;
  return {
    playJoin,
    // an earlier answer may be another world's: it counts once the user plays
    hasJoined: playing && playJoin.data !== undefined,
    // A refused join stands until the next connection: the dialog says why,
    // and its button runs the call again at once on this socket (`retry`)
    joinError: playJoin.status === "error" ? playJoin.error : null,
  };
}

/**
 * The chat the overlay shows: a party's (hostParty and joinParty put the
 * user in it), or the world's (watchWorld does, on the page's spectate
 * join, so it works behind the pre-game dialog).
 */
function chatOf(party: PartyState | null, worldChatId: string | null | undefined): string | null {
  return (party === null ? worldChatId : party.chatId) ?? null;
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
  /** Why the current socket's join was refused, for people. */
  joinError: string | undefined;
  /** The page's party, and its actions (signed-in players only). */
  party: PartySession;
  onRespawn: () => void;
  onStart: (guestName?: string) => void;
  onLogin: () => void;
}

function buildDialog(inputs: DialogInputs): React.ReactElement | null {
  // Before the first join, after a death, and while a join stands refused
  // (a respawn's, or a reconnect's after the user played)
  if (inputs.hasJoined && inputs.death === null && inputs.joinError === undefined) return null;
  const dead = inputs.death !== null;
  const { party } = inputs.party;
  // hosting and joining need a signed-in socket (guests sign in first)
  const partyActions =
    inputs.userId === null
      ? {}
      : {
          onHostParty: inputs.party.host,
          onJoinParty: inputs.party.join,
          onLeaveParty: inputs.party.leave,
        };
  return (
    <PreGameDialog
      {...partyActions}
      {...(party === null ? {} : { party: { code: party.code, role: party.role } })}
      partyBusy={inputs.party.busy}
      {...(inputs.party.error === undefined ? {} : { partyError: inputs.party.error })}
      {...(inputs.party.ended === null ? {} : { partyEnded: inputs.party.ended })}
      mode={dead ? "dead" : "start"}
      lastRunLength={inputs.death?.len}
      bestLength={inputs.userId ? (inputs.bestLength ?? 0) : undefined}
      topScores={inputs.topScores ?? []}
      canStart={inputs.needsGuest ? true : inputs.ready}
      starting={inputs.starting}
      needsGuest={inputs.needsGuest}
      joinError={inputs.joinError}
      onStart={dead ? inputs.onRespawn : inputs.onStart}
      onLogin={inputs.onLogin}
    />
  );
}

function focusCanvas(): void {
  // the game client's canvas, or a party's Godot embed
  (document.getElementById("game-canvas") ?? document.getElementById("godot-canvas"))?.focus();
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
