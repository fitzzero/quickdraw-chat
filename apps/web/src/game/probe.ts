/**
 * The page's probe for `check:web` (apps/api/src/bench/web-session.ts).
 * Under `?probe=1` (development, or NEXT_PUBLIC_ENABLE_BENCH=1) the client
 * records what it sees as entries the runner drains from
 * `window.QuickdrawProbe`, and takes two controls from it: a steer target
 * for the local snake (a driven page has no pointer) and a blackout of the
 * wire's snapshots (as if the stream lost a second of them). Nothing here
 * runs without the flag.
 */

import type {
  GameDeathEvent,
  GameJoin,
  GameTransport,
  GameWire,
  RenderedWorld,
  WorldSnapshot,
} from "@project/shared";

/** One thing the client saw, with the page's wall time. */
export interface ProbeEntry {
  readonly kind: string;
  readonly t: number;
  readonly [field: string]: unknown;
}

/**
 * What the runner reads and sets on the page (`window.QuickdrawProbe`). The
 * sink holds every control: the page's client is remade per user and world
 * (and React, in development, constructs one it discards), and whichever
 * probe serves the live client reads the sink.
 */
export interface ProbeSink {
  entries: ProbeEntry[];
  /** Where the local snake steers; null for the pointer. */
  target: { x: number; y: number } | null;
  /** Until when (performance.now) the wire's snapshots are dropped. */
  mutedUntil: number;
  /** The newest snapshot's tick the wire heard, muted or not. */
  latestTick: number;
  /** The hello recorded last (`user@server`), until the connection is lost: a listener added later hears it again. */
  lastHello: string | null;
  /** The entries since the last drain, oldest first. */
  drain(): ProbeEntry[];
  /** Steers the local snake toward a world point, until the next call. */
  steer(x: number, y: number): void;
  /** Drops the wire's snapshots for `ms` (keyframes pass): the stream lost them. */
  blackout(ms: number): void;
}

declare global {
  interface Window {
    /** The check:web probe's sink, under `?probe=1`. */
    QuickdrawProbe?: ProbeSink;
  }
}

function pushTo(sink: ProbeSink, kind: string, fields: Record<string, unknown> = {}): void {
  sink.entries.push({ kind, t: Date.now(), ...fields });
}

function installSink(): ProbeSink {
  const existing = window.QuickdrawProbe;
  if (existing !== undefined) return existing;
  const sink: ProbeSink = {
    entries: [],
    target: null,
    mutedUntil: 0,
    latestTick: 0,
    lastHello: null,
    drain() {
      const drained = this.entries;
      this.entries = [];
      return drained;
    },
    steer(x, y) {
      this.target = { x, y };
    },
    blackout(ms) {
      this.mutedUntil = performance.now() + ms;
      pushTo(this, "blackout", { phase: "start", tick: this.latestTick });
      window.setTimeout(
        () => pushTo(this, "blackout", { phase: "end", tick: this.latestTick }),
        ms,
      );
    },
  };
  window.QuickdrawProbe = sink;
  return sink;
}

/** A coordinate as the probe reports it: a tenth of a pixel. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export class GameProbe {
  private readonly sink = installSink();

  /** Where the shell steers the local snake instead of the pointer; null for the pointer. */
  public get steerTarget(): { x: number; y: number } | null {
    return this.sink.target;
  }

  public push(kind: string, fields: Record<string, unknown> = {}): void {
    pushTo(this.sink, kind, fields);
  }

  /** A hello: once per connection (the client replays the current one to each new listener). */
  public connected(userId: string | null, serverId: string): void {
    const key = `${String(userId)}@${serverId}`;
    if (this.sink.lastHello === key) return;
    this.sink.lastHello = key;
    this.push("connected", { userId, serverId });
  }

  /** The connection was lost; the next hello is news again. */
  public disconnected(status: string): void {
    this.sink.lastHello = null;
    this.push("disconnected", { status });
  }

  /** Every half second: the local snake, and where every other snake is drawn, on the client's clocks. */
  public seen(rendered: RenderedWorld, latestTick: number): void {
    const drawn: Record<string, [number, number]> = {};
    for (const [id, snake] of rendered.remotes) drawn[id] = [tenth(snake.x), tenth(snake.y)];
    this.push("seen", {
      tick: latestTick,
      renderTick: rendered.renderTick,
      me: rendered.local === null ? null : [tenth(rendered.local.x), tenth(rendered.local.y)],
      drawn,
    });
  }

  /** Every half second: the food the client holds, the tick whose changes it holds, and the keyframes it asked for after a gap. */
  public food(state: { tick: number; ids: string[]; resyncs: number }): void {
    this.push("food", { tick: state.tick, ids: state.ids, resyncs: state.resyncs });
  }

  public death(death: GameDeathEvent): void {
    this.push("death", {
      id: death.id,
      len: death.len,
      by: death.by?.id ?? null,
      contact: death.contact ?? null,
    });
  }

  public left(id: string): void {
    this.push("left", { id });
  }

  /**
   * The transport under the sink's blackout: a muted snapshot never reaches
   * the client (its tick is still the latest heard, which the blackout's
   * entries name), and `joined` says the world was joined (a party's, when
   * `party`: the page's clients share the sink).
   */
  public wrap(transport: GameTransport, party: boolean): GameTransport {
    const { sink } = this;
    const muted = (wire: GameWire): GameWire => ({
      follow: (serverId) => wire.follow(serverId),
      snapshot: (snapshot: WorldSnapshot) => {
        sink.latestTick = snapshot.tick;
        if (performance.now() < sink.mutedUntil) return;
        wire.snapshot(snapshot);
      },
      keyframe: (keyframe) => wire.keyframe(keyframe),
      death: (death) => wire.death(death),
      left: (id) => wire.left(id),
    });
    return {
      get needsKeyframe(): boolean {
        return transport.needsKeyframe;
      },
      start: async (wire, spectator): Promise<GameJoin> => {
        const joined = await transport.start(muted(wire), spectator);
        this.push("joined", { bounds: joined.bounds, spectator, party });
        return joined;
      },
      sendInput: (frames) => transport.sendInput(frames),
      requestKeyframe: () => transport.requestKeyframe(),
      respawn: () => transport.respawn(),
      close: () => transport.close(),
    };
  }
}
