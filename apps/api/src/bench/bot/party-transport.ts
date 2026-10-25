/**
 * A party's wire for a bot (host mode, Tier 1): one end of a loopback link
 * to the party's host in process (core's createLoopbackPeerLink, with the
 * scenario's lag and loss), carrying the app's own payloads as a host's
 * links carry them in the app: the bot's input on `fast`, the host's
 * snapshots on `fast` (raw: nothing to decode, every player named inline),
 * its events and a keyframe on `rel`. Host mode's own framing is exercised
 * by check:godot and the browser test, not here. The party's server
 * (joinParty, playParty) is the runner's: `play` spawns the bot at once.
 */

import type { PeerLink } from "@fitzzero/quickdraw-core/client/core";
import type {
  GameDeathEvent,
  GameInput,
  GameJoin,
  GameTransport,
  GameWire,
  PlayerSnap,
  WorldSnapshot,
} from "@project/shared";

/** What a bot's end sends the host: one input message, or an ask for the world now. */
export type ToHost = { frames: GameInput[] } | { want: "keyframe" };

/** What the host sends a bot's end on `rel` when asked: the world now. */
export interface KeyframeReply {
  keyframe: WorldSnapshot;
}

/** The party as the runner gives it to a bot: its host's sim, as the server and the host would answer. */
export interface PartySide {
  /** The world's bounds (the party's tunables). */
  readonly bounds: { w: number; h: number };
  /** Resolves at the phase of the host's tick every bot's input clock starts at. */
  aligned(): Promise<void>;
  /** The server's word that the bot plays (playParty, partyPlayer): the host spawns its snake, or respawns it. */
  play(): void;
  /** The bot's own snake now, once spawned. */
  own(): PlayerSnap | undefined;
}

/** Resolves once the link is open. */
async function opened(end: PeerLink): Promise<void> {
  if (end.state === "open") return;
  await new Promise<void>((resolve) => {
    const off = end.on("open", () => {
      off();
      resolve();
    });
  });
}

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

export class PartyTransport implements GameTransport {
  /** A party's snapshots name every player inline. */
  public readonly needsKeyframe = false;
  private readonly keyframes: (() => void)[] = [];

  constructor(
    private readonly end: PeerLink,
    private readonly party: PartySide,
  ) {}

  public async start(wire: GameWire, spectator: boolean): Promise<GameJoin> {
    // One host for the run: its ticks start once, as one server's
    wire.follow("party-host");
    this.end.on("message", (data) => this.onMessage(wire, data));
    await opened(this.end);
    // The feed's seed first, as a subscribe answers it: the food now
    await this.requestKeyframe();
    if (spectator) return { bounds: this.party.bounds };
    // The bot's input clock starts once this resolves: at every bot's phase
    await this.party.aligned();
    this.party.play();
    const own = this.party.own();
    return { bounds: this.party.bounds, ...(own ? { own } : {}) };
  }

  /** The host's word: a snapshot (fast), one of its events, or the keyframe asked for (rel). */
  private onMessage(wire: GameWire, data: unknown): void {
    if (!isObject(data)) return;
    if ("keyframe" in data) {
      wire.keyframe((data as unknown as KeyframeReply).keyframe);
      for (const resolve of this.keyframes.splice(0)) resolve();
    } else if (data.kind === "death") {
      wire.death(data as unknown as GameDeathEvent);
    } else if (data.kind === "left" && typeof data.id === "string") {
      wire.left(data.id);
    } else if (typeof data.tick === "number" && Array.isArray(data.players)) {
      wire.snapshot(data as unknown as WorldSnapshot);
    }
  }

  public sendInput(frames: GameInput[]): void {
    const message: ToHost = { frames };
    this.end.send("fast", message);
  }

  /** As a resubscribe of partyWorld: the host answers the world now, on `rel`. */
  public requestKeyframe(): Promise<void> {
    return new Promise((resolve) => {
      this.keyframes.push(resolve);
      const message: ToHost = { want: "keyframe" };
      this.end.send("rel", message);
    });
  }

  public respawn(): void {
    this.party.play();
  }

  public close(): void {
    this.end.close();
  }
}
