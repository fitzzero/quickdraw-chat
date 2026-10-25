/**
 * PartyWorld — a party's world as its host runs it (host mode): the sim and
 * its loop, wherever the host runs (the host's web page, check:web's Node
 * host, the bench's loopback host). It knows nothing of links or sockets.
 * The host hands it the server's word on who plays (`play`, `leave`: the
 * partyPlayer and partyPlayerLeft events) and each player's input, and it
 * sends what the party's two streams carry through `emit`: every tick's
 * snapshot (partyWorld, volatile) and the party's events (partyEvents,
 * reliable). The host drives it with `tick()` from a timer of its own (a
 * Worker's, in a page: a hidden tab throttles the page's timers), or with
 * `start()`, the loop's own timers.
 */

import type {
  GameInput,
  LeaderboardEntry,
  PartyEvent,
  PartyLeaderboard,
  WorldSnapshot,
} from "../types/game.js";
import { GAME_TICK_RATE } from "../types/game.js";
import { GameLoop, type GameLoopDeps } from "./loop.js";
import { GameWorldSim, type GameTunables } from "./world.js";

/** What a party's sim runs: the defaults, with a few NPCs so a party of two has company. */
export const PARTY_TUNABLES: Partial<GameTunables> = { npcCount: 4 };

/** The most lag the fair link gives the host's own user (ms). */
export const FAIR_LINK_MAX_MS = 100;

/** How often a host measures its links again and sets the fair link (ms). */
export const FAIR_LINK_EVERY_MS = 5_000;

/** A peer as a host's links know it: its user, and its link's clock (core's HostPeer has this shape). */
export interface LinkedPeer {
  readonly userId: string;
  readonly link: { readonly clock: { readonly rtt: number; readonly synced: boolean } };
}

/**
 * Each linked user's round trip to the host (ms, rounded): the longest of
 * its links whose clock has synced (a player's page and its game are two
 * sockets, two links). A link that has not synced yet reads 0 and is left out.
 */
export function roundTrips(peers: readonly LinkedPeer[]): Record<string, number> {
  const rttMs: Record<string, number> = {};
  for (const { userId, link } of peers) {
    if (!link.clock.synced) continue;
    rttMs[userId] = Math.max(rttMs[userId] ?? 0, Math.round(link.clock.rtt));
  }
  return rttMs;
}

/**
 * The fair link: the lag a host gives its own user's links, both ways, so
 * that the host's input reaches the sim no sooner than its players' and its
 * snapshots arrive no sooner. It is the median of the other users' one-way
 * trips (half the round trip), at most FAIR_LINK_MAX_MS, and 0 when nobody
 * else is linked. The host's own links are left out: they carry the lag
 * this sets, which would feed back on itself.
 */
export function fairLinkMs(rttMs: Readonly<Record<string, number>>, hostUserId: string): number {
  const oneWay = Object.entries(rttMs)
    .filter(([userId]) => userId !== hostUserId)
    .map(([, ms]) => ms / 2)
    .sort((a, b) => a - b);
  const median = oneWay[Math.floor(oneWay.length / 2)] ?? 0;
  return Math.min(FAIR_LINK_MAX_MS, Math.max(0, Math.round(median)));
}

/** A peer whose link a host lags: core's HostPeer has this shape, and so has a loopback end. */
export interface LaggablePeer extends LinkedPeer {
  readonly link: LinkedPeer["link"] & { setLag(lag: { readonly ms: number } | null): void };
}

/** What a host's links measured: each player's round trip (ms, by user) and the fair link's lag. */
export interface PartyLinks {
  readonly rttMs: Readonly<Record<string, number>>;
  /** The lag the host's own user plays with (ms); null when the fair link is off. */
  readonly fairLinkMs: number | null;
}

/**
 * What a host does every FAIR_LINK_EVERY_MS: measures its links, and lags
 * its own user's links by the fair link, both ways (or ends their lag when
 * `fair` is false). Answers what it measured.
 */
export function settleFairLink(
  peers: readonly LaggablePeer[],
  hostUserId: string,
  fair: boolean,
): PartyLinks {
  const rttMs = roundTrips(peers);
  const lag = fair ? fairLinkMs(rttMs, hostUserId) : null;
  for (const peer of peers) {
    if (peer.userId === hostUserId)
      peer.link.setLag(lag === null || lag === 0 ? null : { ms: lag });
  }
  return { rttMs, fairLinkMs: lag };
}

/** What a party's world sends: one callback per stream. */
export interface PartyWorldEmits {
  /** Every tick's snapshot (partyWorld, volatile). */
  world: (snapshot: WorldSnapshot) => void;
  /** A join, a leave, a death or the leaderboard (partyEvents, reliable). */
  event: (event: PartyEvent) => void;
}

export interface PartyWorldOptions {
  readonly emit: PartyWorldEmits;
  /** The sim's seed; default the sim's own. */
  readonly seed?: number;
  /** Over PARTY_TUNABLES. */
  readonly tunables?: Partial<GameTunables>;
  /** The loop's measurements (the bench's ground truth). */
  readonly onTick?: GameLoopDeps["onTick"];
}

export class PartyWorld {
  public readonly sim: GameWorldSim;
  public readonly loop: GameLoop;
  private readonly emit: PartyWorldEmits;
  private ticks = 0;
  private board: LeaderboardEntry[] = [];
  private rttMs: Record<string, number> = {};
  private fairLink: number | null = null;

  constructor(options: PartyWorldOptions) {
    this.emit = options.emit;
    this.sim = new GameWorldSim({
      seed: options.seed,
      tunables: { ...PARTY_TUNABLES, ...options.tunables },
    });
    this.loop = new GameLoop({
      sim: this.sim,
      emit: {
        snapshot: (snapshot): WorldSnapshot => {
          this.emit.world(snapshot);
          return snapshot;
        },
        death: (death): void => {
          this.emit.event({ kind: "death", ...death });
        },
        leaderboard: (entries): void => {
          this.board = entries;
          this.emit.event(this.leaderboard());
        },
      },
      // A party runs while its host serves it, with players or without:
      // its NPCs keep the world going behind the players' dialogs
      hasAudience: (): boolean => true,
      ...(options.onTick ? { onTick: options.onTick } : {}),
    });
  }

  /** A user asked to play (the server's partyPlayer): spawns their snake, or respawns a dead one. */
  public play(userId: string, name: string | null): void {
    const { meta, isNew } = this.sim.addPlayer(userId, name);
    if (isNew) this.emit.event({ kind: "joined", ...meta });
  }

  /** A user left the party (the server's partyPlayerLeft): takes their snake out. */
  public leave(userId: string): void {
    if (this.sim.removePlayer(userId)) this.emit.event({ kind: "left", id: userId });
  }

  /** One input message of a player (partyInput), queued as the server queues the world's. */
  public input(userId: string, frames: readonly GameInput[]): void {
    this.sim.queueInputs(userId, frames);
  }

  /** partyWorld's seed: the world now (every snake, all the food). */
  public keyframe(): WorldSnapshot {
    return this.sim.keyframe();
  }

  /** partyEvents' seed: a `joined` for every player (names and hues), then the latest leaderboard. */
  public seedEvents(): PartyEvent[] {
    const joined = this.sim
      .getBootstrapState()
      .players.map((meta): PartyEvent => ({ kind: "joined", ...meta }));
    return [...joined, this.leaderboard()];
  }

  /** What the host's links measured (roundTrips) and the fair link's lag (null: off), for the leaderboard. */
  public setLinks(rttMs: Record<string, number>, fairLink: number | null): void {
    this.rttMs = rttMs;
    this.fairLink = fairLink;
  }

  /** One tick, from the host's timer; the leaderboard every GAME_TICK_RATE ticks (once a second). */
  public tick(): void {
    this.loop.tickOnce();
    this.ticks += 1;
    if (this.ticks % GAME_TICK_RATE === 0) this.loop.emitLeaderboard();
  }

  /** Runs the loop on its own timers (a Node host); `tick()` is for a host with a timer of its own. */
  public start(): void {
    this.loop.start();
  }

  public stop(): void {
    this.loop.stop();
  }

  private leaderboard(): PartyLeaderboard {
    return {
      kind: "leaderboard",
      entries: this.board,
      rttMs: this.rttMs,
      fairLinkMs: this.fairLink,
    };
  }
}
