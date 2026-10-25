"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { useQuickdraw } from "@fitzzero/quickdraw-core/client";
import {
  createQuickdrawConnection,
  type QuickdrawConnection,
} from "@fitzzero/quickdraw-core/client/core";
import {
  DEFAULT_TUNABLES,
  PARTY_TUNABLES,
  type GameTransport,
  type GameTunables,
  type RemotesMode,
  type WorldBootstrap,
} from "@project/shared";
import { qd } from "../lib/quickdraw";
import { BenchTelemetry } from "./bench";
import { PartyWire } from "./PartyWire";
import { GameProbe } from "./probe";
import { GAME_BACKGROUND_CSS } from "./render/palette";
import { createPixiRenderer } from "./render/pixi";
import type { GameRenderer, RenderBackend } from "./render/renderer";
import { GameShell, type GameStats } from "./shell";
import type { GameLoadState } from "./types";
import { PageTransport } from "./wire/pageTransport";
import { PartyTransport } from "./wire/partyTransport";

/** Bench mode (`?bench=1`): a connection of the client's own, to the bench server, as this user. */
export interface GameBenchMode {
  apiUrl: string;
  userId: string;
}

/** A party (host mode): its world, and whether its feeds may subscribe yet (a host's page serves first). */
export interface GamePartyMode {
  worldId: string;
  ready: boolean;
}

export interface GameCanvasProps {
  /**
   * The world the page's watchWorld join answered (bounds, players, snakes,
   * food); null until it did. The page's socket is in the world's room
   * through that join, and joins the game while the user plays.
   */
  bootstrap: WorldBootstrap | null;
  onStateChange?: (state: GameLoadState) => void;
  bench?: GameBenchMode;
  /** The party the page is in: the world comes from its host, not the server. */
  party?: GamePartyMode | null;
}

const TUNABLES_KEY = { type: "tunables", key: "snake" };
/** The probe (`?probe=1`, check:web) is for development and bench builds, as bench mode is. */
const PROBE_ALLOWED =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_BENCH === "1";
/** Bench mode respawns the snake itself this long after a death (no dialog in a driven page). */
const BENCH_RESPAWN_MS = 750;
/** A party runs the default tunables (PARTY_TUNABLES over them): no definition to read. */
const PARTY_GAME_TUNABLES: GameTunables = { ...DEFAULT_TUNABLES, ...PARTY_TUNABLES };
const PARTY_BOUNDS = { w: PARTY_GAME_TUNABLES.worldWidth, h: PARTY_GAME_TUNABLES.worldHeight };

/**
 * The game, drawn in the page: the shared netcode core and a PixiJS
 * renderer under one frame loop (shell.ts), on the page's own socket. React
 * owns the box and the loading state; each client run gets a canvas of its
 * own, and the shell owns everything that moves. Keyed by GameSurface per user and world, so a sign-in or a
 * party starts a new client.
 */
export function GameCanvas({
  bootstrap,
  onStateChange,
  bench,
  party,
}: GameCanvasProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const shellRef = React.useRef<GameShell | null>(null);
  const { connection, userId, status } = useQuickdraw();
  const [stats, setStats] = React.useState<GameStats | null>(null);
  const flags = React.useMemo(readFlags, []);
  const partyWorldId = party?.worldId ?? null;
  // check:web's probe: one per client (the canvas remounts per user and world)
  const probe = React.useMemo(() => (flags.probe ? new GameProbe() : null), [flags]);
  useProbeOfConnection(probe, connection, status);
  qd.gameService.leaderboard.useEvent((entries) => {
    probe?.push("leaderboard", { ids: entries.map((entry) => entry.id) });
  });

  // The movement tunables the server simulates with, so the prediction
  // steps as the server does; bench mode and a party run the defaults, as
  // the bench's scenarios and a host do
  const definition = qd.definitionService.getDefinition.useQuery(TUNABLES_KEY, {
    enabled: bench === undefined && partyWorldId === null,
  });
  const settled = bench !== undefined || partyWorldId !== null || !definition.isPending;
  const tunables = React.useMemo(
    () => (partyWorldId === null ? tunablesFrom(definition.data?.data) : PARTY_GAME_TUNABLES),
    [definition.data, partyWorldId],
  );
  const stateChangeRef = React.useRef(onStateChange);
  stateChangeRef.current = onStateChange;
  // The party's wire: fed by PartyWire below, read by the core like the
  // server's; a feed the host refused is this client's error
  const partyTransport = React.useMemo(
    () =>
      partyWorldId === null
        ? null
        : new PartyTransport({
            worldId: partyWorldId,
            bounds: PARTY_BOUNDS,
            onPlayer: (meta) => shellRef.current?.addPlayer(meta),
            onError: (error) =>
              stateChangeRef.current?.({ phase: "error", message: error.message }),
          }),
    [partyWorldId],
  );
  const bootstrapRef = React.useRef(bootstrap);
  bootstrapRef.current = bootstrap;
  const hasBootstrap = bootstrap !== null;
  const benchApi = bench?.apiUrl;
  const benchUser = bench?.userId;

  React.useEffect(() => {
    const host = hostRef.current;
    const joined = benchApi !== undefined || partyTransport !== null || hasBootstrap;
    if (host === null || !settled || !joined) return undefined;
    // A canvas of this run's own: destroying a renderer loses its canvas's
    // GL context, so the next client (a tunables change; StrictMode's second
    // mount in development) must not inherit the element
    const canvas = makeCanvas();
    host.appendChild(canvas);
    const client = createClient({
      canvas,
      connection,
      userId,
      bench:
        benchApi === undefined || benchUser === undefined
          ? null
          : { apiUrl: benchApi, userId: benchUser },
      bootstrap: () => bootstrapRef.current,
      party: partyTransport,
      probe,
      tunables,
      flags,
      onState: (state) => stateChangeRef.current?.(state),
      onStats: setStats,
    });
    shellRef.current = client.shell;
    const observer = new ResizeObserver(() => client.renderer.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      shellRef.current = null;
      client.shell.stop();
      canvas.remove();
    };
  }, [
    connection,
    userId,
    benchApi,
    benchUser,
    hasBootstrap,
    partyTransport,
    probe,
    settled,
    tunables,
    flags,
  ]);

  // The players every join answers (a reconnect; a new world after a server
  // restart draws new hues, and the snapshots name players by id alone)
  React.useEffect(() => {
    if (bootstrap === null) return;
    shellRef.current?.addPlayers(bootstrap.players);
    probe?.push("world", { tick: bootstrap.tick, players: bootstrap.players.map((p) => p.id) });
  }, [bootstrap, probe]);

  return (
    <Box ref={hostRef} sx={{ position: "absolute", inset: 0, bgcolor: GAME_BACKGROUND_CSS }}>
      {stats !== null && (
        <Box
          component="pre"
          sx={{
            position: "absolute",
            left: 12,
            bottom: 8,
            m: 0,
            fontFamily: "monospace",
            fontSize: 12,
            color: "grey.500",
            pointerEvents: "none",
          }}
        >
          {formatStats(stats)}
        </Box>
      )}
      {party !== undefined && party !== null && partyTransport !== null && (
        <PartyWire worldId={party.worldId} transport={partyTransport} enabled={party.ready} />
      )}
    </Box>
  );
}

/** What the page's connection says, for the probe: each hello, and each loss of the connection. */
function useProbeOfConnection(
  probe: GameProbe | null,
  connection: QuickdrawConnection,
  status: string,
): void {
  React.useEffect(() => {
    if (probe === null) return undefined;
    return connection.onHello((hello) => {
      probe.connected(hello.userId, hello.serverId);
    });
  }, [probe, connection]);
  const wasConnected = React.useRef(false);
  React.useEffect(() => {
    if (probe === null) return;
    if (status === "connected") wasConnected.current = true;
    else if (wasConnected.current) {
      wasConnected.current = false;
      probe.disconnected(status);
    }
  }, [probe, status]);
}

/** The canvas the engine draws to: the chat overlay and the dialog hand keyboard focus back to it by id. */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.id = "game-canvas";
  canvas.tabIndex = 0;
  canvas.style.cssText = "width:100%;height:100%;display:block;outline:none;touch-action:none";
  return canvas;
}

interface ClientInputs {
  canvas: HTMLCanvasElement;
  connection: QuickdrawConnection;
  userId: string | null;
  bench: GameBenchMode | null;
  bootstrap: () => WorldBootstrap | null;
  /** The party's transport, fed by PartyWire; null for the server's world. */
  party: PartyTransport | null;
  /** check:web's probe, or null. */
  probe: GameProbe | null;
  tunables: GameTunables;
  flags: GameFlags;
  onState: (state: GameLoadState) => void;
  onStats: (stats: GameStats) => void;
}

/**
 * The client: the transport over the page's connection (or, in bench mode,
 * one of its own to the bench server; or the party's, fed by the bridge),
 * the PixiJS renderer and the shell that drives them; started here, stopped
 * by the effect's cleanup.
 */
function createClient(inputs: ClientInputs): { shell: GameShell; renderer: GameRenderer } {
  const { bench, flags } = inputs;
  const own = ownConnection(inputs);
  const player = bench?.userId ?? inputs.userId;
  const renderer = createPixiRenderer(inputs.tunables);
  const sink = bench === null ? undefined : window.QuickdrawBench;
  const shell: GameShell = new GameShell({
    canvas: inputs.canvas,
    transport: probed(
      inputs.probe,
      inputs.party ??
        new PageTransport({
          connection: own ?? inputs.connection,
          join: own === null ? { kind: "page", bootstrap: inputs.bootstrap } : { kind: "self" },
          userId: player,
          onPlayer: (meta) => shell.addPlayer(meta),
        }),
      inputs.party !== null,
    ),
    renderer,
    userId: player,
    tunables: inputs.tunables,
    players: inputs.bootstrap()?.players ?? [],
    ...(flags.preference === undefined ? {} : { preference: flags.preference }),
    ...(flags.remotes === undefined ? {} : { remotes: flags.remotes }),
    ...(sink === undefined ? {} : { telemetry: new BenchTelemetry(sink) }),
    ...(own === null ? {} : { autoRespawnMs: BENCH_RESPAWN_MS }),
    ...(inputs.probe === null ? {} : { probe: inputs.probe }),
    onState: inputs.onState,
    ...(flags.debug ? { onStats: inputs.onStats } : {}),
  });
  shell.start().catch((error: unknown) => {
    inputs.onState({
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return { shell, renderer };
}

/** The transport under the probe's controls (a blackout of its snapshots), or itself. */
function probed(probe: GameProbe | null, transport: GameTransport, party: boolean): GameTransport {
  return probe === null ? transport : probe.wrap(transport, party);
}

/** Bench mode's connection of the client's own, to the bench server; none for the page's world or a party. */
function ownConnection({ bench, party }: ClientInputs): QuickdrawConnection | null {
  if (bench === null || party !== null) return null;
  return createQuickdrawConnection({ url: bench.apiUrl, auth: { userId: bench.userId } });
}

interface GameFlags {
  preference?: RenderBackend;
  debug: boolean;
  probe: boolean;
  /** Where the remotes render (`?remotes=playback|present`); the core's default when unset. */
  remotes?: RemotesMode;
}

/**
 * The page's flags: `?gpu=webgl|webgpu` picks the backend, `?debug=1` shows
 * the renderer's stats, `?probe=1` records what the client sees for
 * check:web (development and bench builds only), `?remotes=playback|present`
 * picks where the remotes render (A/B play).
 */
function readFlags(): GameFlags {
  if (typeof window === "undefined") return { debug: false, probe: false };
  const params = new URLSearchParams(window.location.search);
  const gpu = params.get("gpu");
  const remotes = params.get("remotes");
  return {
    ...(gpu === "webgl" || gpu === "webgpu" ? { preference: gpu } : {}),
    debug: params.get("debug") === "1",
    probe: PROBE_ALLOWED && params.get("probe") === "1",
    ...(remotes === "playback" || remotes === "present" ? { remotes } : {}),
  };
}

/** The definition's numbers over the defaults: a positive finite number per known key, nothing else. */
function tunablesFrom(data: unknown): GameTunables {
  const out: GameTunables = { ...DEFAULT_TUNABLES };
  if (typeof data !== "object" || data === null) return out;
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof GameTunables)[]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

function formatStats(stats: GameStats): string {
  const draws = stats.drawCalls === null ? "–" : String(stats.drawCalls);
  const work = `${stats.frameWorkMs.mean.toFixed(1)}/${stats.frameWorkMs.p99.toFixed(1)} ms`;
  return `${stats.backend ?? "…"} · ${stats.fps.toFixed(0)} fps · ${work} work · ${draws} draws · ${stats.geometryBuilds} builds · tick ${stats.tick}`;
}
