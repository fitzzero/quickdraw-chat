/**
 * What a game client's netcode needs of the wire, whichever carries it:
 * the server's protocol v5 socket (the bench's socket-transport.ts, the
 * web page's transport over its own socket: the world on the server) or a
 * link to a party's host (the bench's party-transport.ts over a loopback
 * link, the page's over a peer link: host mode). The transport joins the
 * world, decodes what arrives and hands it to the client as snapshots,
 * keyframes and events; the client's prediction, interpolation, clocks and
 * food (GameClientCore) are the same over either.
 */

import type { GameDeathEvent, GameInput, PlayerSnap, WorldSnapshot } from "../../types/game.js";

/** What a transport hands the client. */
export interface GameWire {
  /** The world's clock follows this server (or host): another one starts its ticks over. */
  follow(serverId: string): void;
  /** One tick of the world, decoded. */
  snapshot(snapshot: WorldSnapshot): void;
  /** The world now (a stream's seed): its food replaces the bot's. */
  keyframe(keyframe: WorldSnapshot): void;
  death(death: GameDeathEvent): void;
  /** A player left the world. */
  left(id: string): void;
}

/** What joining answered: the world's bounds, and the client's own snake when it spawned with it. */
export interface GameJoin {
  readonly bounds: { w: number; h: number };
  readonly own?: PlayerSnap;
}

export interface GameTransport {
  /** Connects and joins the world (as a player, or a spectator). */
  start(wire: GameWire, spectator: boolean): Promise<GameJoin>;
  /** One input message: the step's frame last, with up to three unacknowledged ones before it. */
  sendInput(frames: GameInput[]): void;
  /** Asks for a keyframe; resolves once it arrived (and went to `keyframe`) or the ask failed. */
  requestKeyframe(): Promise<void>;
  /** Asks to respawn after a death. */
  respawn(): void;
  /** True when a snapshot named a player by an introduction the client missed (packed snapshots only). */
  readonly needsKeyframe: boolean;
  close(): void;
}
