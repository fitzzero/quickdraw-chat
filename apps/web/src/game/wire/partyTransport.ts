/**
 * A party's wire for the web client (host mode): the party's world comes
 * from the hosting player's browser over a peer link, not from the server.
 * The page's `useParty` hosts or joins the party on the page's socket; this
 * transport is fed by `PartyWire.tsx`, a React bridge over the typed
 * client's `useStream` and `useChannel` of the host-served members, which
 * reach the room's host over the link the client opens: `partyWorld` (raw
 * WorldSnapshots, every player named inline; its seed a keyframe),
 * `partyEvents` (joins, leaves, deaths, the leaderboard, in order) and
 * `partyInput` back on the link's `fast`. The bridge hands items in here;
 * the core reads them through the same GameWire the server's world uses.
 * A keyframe is told by its shape: the host's loop stamps a send time on
 * every tick's snapshot (`t`), and a seed is the sim's keyframe, which
 * carries none.
 *
 * quickdraw-5.0 finding: the typed client has no React-free way to
 * subscribe to a host-served stream or send on a host-served channel over
 * the page's socket (the React hooks alone speak host mode's link framing,
 * which an app must never hand-write; 5.1.4's `holdStream` needs a live
 * store of its own connection, and `liveStoreOf` throws on the provider's,
 * the socket the party's room holds; no channel has a React-free send), so
 * the 20 Hz feed crosses a React component; and a stream has no refresh,
 * so a keyframe ask is the bridge's to serve (PartyWire).
 * The quickdraw card
 * `client-core-streams-channels-and-events-without-react-host-s` asks for
 * the API; when it ships, this transport subscribes itself and the bridge
 * goes.
 */

import type {
  GameDeathEvent,
  GameInput,
  GameInputs,
  GameJoin,
  GamePlayerMeta,
  GameTransport,
  GameWire,
  PartyEvent,
  WorldSnapshot,
} from "@project/shared";
import { partyRoom } from "@project/shared";

/** How long a keyframe ask waits for the bridge's new seed before the next snapshot past the window asks again. */
export const KEYFRAME_TIMEOUT_MS = 5_000;

export interface PartyTransportOptions {
  worldId: string;
  /** The party's bounds (PARTY_TUNABLES over the defaults; joinParty answers the same). */
  bounds: { w: number; h: number };
  /** A player's name and hue: the seed's `joined` for every player, then each later join. */
  onPlayer?: (meta: GamePlayerMeta) => void;
  /** A feed the host refused (no host serves the room, or it refused this user): final until a new subscription. */
  onError?: (error: Error) => void;
}

/** What the bridge gives the transport while it is mounted. */
export interface PartyBridge {
  /** The channel's `send` while the socket is connected, null until then (a frame with no link to the host is dropped, as the wire would). */
  send: ((payload: GameInputs) => void) | null;
  /** Holds the world feed off for a moment, so its next subscription answers a fresh seed: the keyframe a gap asks for. */
  reseed: () => void;
}

export class PartyTransport implements GameTransport {
  /** A party's snapshots name every player inline. */
  public readonly needsKeyframe = false;
  private wire: GameWire | null = null;
  private bridge: PartyBridge | null = null;
  private readonly keyframeWaiters: (() => void)[] = [];

  constructor(private readonly opts: PartyTransportOptions) {}

  /** The page joined the party already; one host for the party's life, so one `follow`. */
  public start(wire: GameWire): Promise<GameJoin> {
    this.wire = wire;
    wire.follow(partyRoom(this.opts.worldId));
    return Promise.resolve({ bounds: this.opts.bounds });
  }

  /** The bridge mounted (or its channel became ready). */
  public attach(bridge: PartyBridge): void {
    this.bridge = bridge;
  }

  public detach(): void {
    this.bridge = null;
  }

  /**
   * An item of the world feed. A seed is a keyframe (the world now, all the
   * food in one entry) and carries no send time; every tick's snapshot does.
   */
  public item(snapshot: WorldSnapshot): void {
    if (snapshot.t === undefined) {
      this.wire?.keyframe(snapshot);
      for (const resolve of this.keyframeWaiters.splice(0)) resolve();
      return;
    }
    this.wire?.snapshot(snapshot);
  }

  /** An item of the events feed: what the world's events are to the server's world. */
  public event(event: PartyEvent): void {
    if (event.kind === "joined") {
      this.opts.onPlayer?.({ id: event.id, name: event.name, hue: event.hue });
    } else if (event.kind === "left") {
      this.wire?.left(event.id);
    } else if (event.kind === "death") {
      const death: GameDeathEvent = {
        id: event.id,
        len: event.len,
        ...(event.by === undefined ? {} : { by: event.by }),
        ...(event.contact === undefined ? {} : { contact: event.contact }),
      };
      this.wire?.death(death);
    }
    // the leaderboard is the HUD's (useParty reads it)
  }

  public sendInput(frames: GameInput[]): void {
    this.bridge?.send?.({ frames });
  }

  /** A feed the host refused: the client shows it (the store keeps the refusal until a new subscription). */
  public failed(error: Error): void {
    this.opts.onError?.(error);
  }

  /** Asks the bridge for a fresh seed; resolves on the keyframe it brings, or after KEYFRAME_TIMEOUT_MS. */
  public requestKeyframe(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      this.keyframeWaiters.push(finish);
      setTimeout(finish, KEYFRAME_TIMEOUT_MS);
      this.bridge?.reseed();
    });
  }

  /** The page's dialog respawns through playParty (the host spawns on the server's word). */
  public respawn(): void {
    // nothing: the server, not the transport, tells the host to spawn
  }

  /** The client stopped; the bridge stays until PartyWire detaches it (their lifetimes differ). */
  public close(): void {
    this.wire = null;
    for (const resolve of this.keyframeWaiters.splice(0)) resolve();
  }
}
