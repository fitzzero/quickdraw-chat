/**
 * What a bot's netcode needs of the wire, whichever carries it: the
 * server's protocol v5 socket (socket-transport.ts, the world on the
 * server) or a loopback link to a party's host in process
 * (party-transport.ts, host mode). The transport joins the world, decodes
 * what arrives and hands it to the bot as snapshots, keyframes and events;
 * the bot's prediction, interpolation, clocks and food are the same over
 * either.
 */

import type { GameDeathEvent, GameInput, PlayerSnap, WorldSnapshot } from "@project/shared";

/** What a transport hands the bot. */
export interface BotWire {
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

/** What joining answered: the world's bounds, and the bot's own snake when it spawned with it. */
export interface BotJoin {
  readonly bounds: { w: number; h: number };
  readonly own?: PlayerSnap;
}

export interface BotTransport {
  /** Connects and joins the world (as a player, or a spectator). */
  start(wire: BotWire, spectator: boolean): Promise<BotJoin>;
  /** One input message: the step's frame last, with up to three unacknowledged ones before it. */
  sendInput(frames: GameInput[]): void;
  /** Asks for a keyframe; resolves once it arrived (and went to `keyframe`) or the ask failed. */
  requestKeyframe(): Promise<void>;
  /** Asks to respawn after a death. */
  respawn(): void;
  /** True when a snapshot named a player by an introduction the bot missed (packed snapshots only). */
  readonly needsKeyframe: boolean;
  close(): void;
}
