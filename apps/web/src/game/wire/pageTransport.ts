/**
 * The world's wire for the web client: quickdraw protocol v5 frames on a
 * QuickdrawConnection's socket, exactly what the bench bots speak
 * (apps/api/src/bench/bot/socket-transport.ts): `qd:stream:sub` of the
 * world stream (its seed a keyframe, asked again for a keyframe), `qd:stream`
 * items unpacked by one SnapshotDecoder (kept across subscriptions, reset
 * for another server's world), `qd:event` deaths, leaves and joins, `qd:ch`
 * input as a volatile emit. In the page the socket is already in the
 * world's room: GameSurface's useJoin calls watchWorld on every connection,
 * and joinGame while the user plays, so this transport never joins; the
 * world's bounds come from the join's bootstrap. In bench mode (`join:
 * "self"`) it joins and respawns itself on a connection of its own.
 *
 * quickdraw-5.0 finding: the typed client has no React-free way to send on
 * a channel or hear an event, and none to hold a stream on the page's
 * socket (`@fitzzero/quickdraw-core/client/core` gives calls, peer links,
 * defineHost and, since 5.1.4, `holdStream`, which needs a live store of
 * its own connection: `liveStoreOf` throws on the provider's, which this
 * transport runs on in the page; `useStream`, `useChannel` and `useEvent`
 * are React hooks, unfit for a 20 Hz game loop). So this module speaks the
 * frames on `connection.socket` itself, under a `no-raw-socket` lint
 * override scoped to this folder (`.oxlintrc.json`). The quickdraw card
 * `client-core-streams-channels-and-events-without-react-host-s` asks for
 * the API; when it ships, this becomes `streamOf`, `channelOf` and
 * `eventsOf`, and the override goes.
 */

import type {
  EventFrame,
  HelloFrame,
  StreamFrame,
  StreamSubscribeReply,
} from "@fitzzero/quickdraw-core";
import { callData, type QuickdrawConnection } from "@fitzzero/quickdraw-core/client/core";
import type {
  GameBootstrap,
  GameDeathEvent,
  GameInput,
  GameJoin,
  GamePlayerMeta,
  GameTransport,
  GameWire,
  PackedWorldItem,
  WorldBootstrap,
} from "@project/shared";
import { GLOBAL_WORLD_ID, SnapshotDecoder } from "@project/shared";

const WORLD = { worldId: GLOBAL_WORLD_ID };
const WORLD_STREAM = { s: "gameService", stream: "world", scope: GLOBAL_WORLD_ID };
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 30_000;

export interface PageTransportOptions {
  connection: QuickdrawConnection;
  /**
   * How the socket got into the world's room. `page`: the page's own join
   * calls did and do; the bootstrap watchWorld answered gives the bounds.
   * `self`: this transport calls joinGame and respawn itself (bench mode: a
   * connection of its own, no dialog).
   */
  join: { kind: "page"; bootstrap: () => WorldBootstrap | null } | { kind: "self" };
  /** The user the socket acts for: whose snake is the local one (null: a spectator). */
  userId: string | null;
  /** A player's name and hue: the bootstrap's players, then each `playerJoined`. */
  onPlayer?: (meta: GamePlayerMeta) => void;
}

export class PageTransport implements GameTransport {
  /** Unpacks the world stream: kept across resubscribes, reset for another server's world. */
  private readonly decoder = new SnapshotDecoder();
  private serverId: string | null = null;
  private wire: GameWire | null = null;
  private readonly cleanups: (() => void)[] = [];
  private closed = false;

  constructor(private readonly opts: PageTransportOptions) {}

  public get needsKeyframe(): boolean {
    return this.decoder.needsKeyframe;
  }

  public async start(wire: GameWire, spectator: boolean): Promise<GameJoin> {
    this.wire = wire;
    const { connection, join } = this.opts;
    const { socket } = connection;

    // The hello names the server (another one has another id table and a
    // world whose ticks start over) and comes with every connection: a new
    // socket is in no room and holds no subscription, so the world stream
    // is subscribed again on each. A connection already up hands a new
    // listener its hello at once (in a microtask)
    const onHello = (hello: HelloFrame): void => {
      if (hello.serverId !== this.serverId) this.decoder.reset();
      this.serverId = hello.serverId;
      wire.follow(hello.serverId);
      void this.subscribeWorld();
    };
    this.cleanups.push(connection.onHello(onHello));

    const onStream = ([service, stream, , item]: StreamFrame): void => {
      if (service === "gameService" && stream === "world") {
        wire.snapshot(this.decoder.decode((item as PackedWorldItem).b));
      }
    };
    const onEvent = ([service, event, payload]: EventFrame): void => {
      if (service !== "gameService") return;
      if (event === "death") wire.death(payload as GameDeathEvent);
      else if (event === "playerLeft") wire.left((payload as { id: string }).id);
      else if (event === "playerJoined") this.opts.onPlayer?.(payload as GamePlayerMeta);
    };
    socket.on("qd:stream", onStream);
    socket.on("qd:event", onEvent);
    this.cleanups.push(() => {
      socket.off("qd:stream", onStream);
      socket.off("qd:event", onEvent);
    });

    if (join.kind === "self" && connection.getState().hello === null) {
      connection.open();
      await waitForHello(connection);
    }

    // Bench mode opens a connection of its own, so its first hello (and the
    // subscription it brings) lands before the join below, as the bots order
    // them; on a connection already up the subscription follows a microtask
    // later, and the seed is a keyframe the next snapshots supersede anyway
    if (join.kind === "self") return await this.joinSelf(connection, spectator);

    const bootstrap = join.bootstrap();
    if (bootstrap === null) throw new Error("the page has not joined the world yet");
    for (const meta of bootstrap.players) this.opts.onPlayer?.(meta);
    // The snakes the bootstrap holds may be ticks old by now; the first own
    // snapshot places the local snake (GameClientCore.spawnLocal(null))
    return { bounds: bootstrap.bounds };
  }

  /** Bench mode: this socket joins the world, as the bots do. */
  private async joinSelf(connection: QuickdrawConnection, spectator: boolean): Promise<GameJoin> {
    if (spectator) {
      const bootstrap = await callData<WorldBootstrap>(connection, {
        service: "gameService",
        method: "watchWorld",
        input: WORLD,
      });
      for (const meta of bootstrap.players) this.opts.onPlayer?.(meta);
      return { bounds: bootstrap.bounds };
    }
    const bootstrap = await callData<GameBootstrap>(connection, {
      service: "gameService",
      method: "joinGame",
      input: WORLD,
      kind: "mutation",
    });
    for (const meta of bootstrap.players) this.opts.onPlayer?.(meta);
    const own = bootstrap.snaps.find((snap) => snap.id === this.opts.userId);
    return { bounds: bootstrap.bounds, ...(own === undefined ? {} : { own }) };
  }

  /** Subscribes the world stream; its seed (a keyframe) names every player and replaces the food held. */
  private subscribeWorld(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), SUBSCRIBE_TIMEOUT_MS);
      this.opts.connection.socket.emit(
        "qd:stream:sub",
        WORLD_STREAM,
        (reply: StreamSubscribeReply) => {
          clearTimeout(timeout);
          if (reply.ok) {
            for (const seed of reply.seed as readonly PackedWorldItem[]) {
              this.wire?.keyframe(this.decoder.decode(seed.b));
            }
          }
          resolve(reply.ok);
        },
      );
    });
  }

  /** A held feed subscribed again answers a fresh seed. */
  public async requestKeyframe(): Promise<void> {
    await this.subscribeWorld();
  }

  public sendInput(frames: GameInput[]): void {
    // `qd:ch`: fire and forget on Socket.IO's volatile flag, which drops a
    // message while the transport is still writing (a second send in the
    // same tick), backlog or not; the next message repeats a dropped one's
    // frames. useChannel drops one only on a real backlog since quickdraw
    // 5.1.4, and channelOf brings that rule here when it replaces this wire
    // (the finding above). Nothing goes out while the connection is down (a
    // closing socket logs each write as an error): the next message after
    // the hello carries the frames
    if (this.opts.connection.getState().status !== "connected") return;
    this.opts.connection.socket.volatile.emit("qd:ch", ["gameService", "input", { frames }]);
  }

  /** Bench mode respawns itself; in the page the dialog's Respawn runs joinGame again. */
  public respawn(): void {
    if (this.opts.join.kind !== "self" || this.closed) return;
    callData(this.opts.connection, {
      service: "gameService",
      method: "respawn",
      input: WORLD,
      kind: "mutation",
    }).catch(() => {
      // a respawn can race the end of the run; the snake stays dead
    });
  }

  public close(): void {
    this.closed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const { connection, join } = this.opts;
    if (join.kind === "self") {
      connection.close();
      return;
    }
    // The page's socket outlives this client (a party, another route of the
    // app): leave the world stream, or its snapshots keep arriving for
    // nobody. A new socket holds no subscription, so a closed one needs none
    if (connection.getState().status === "connected") {
      connection.socket.emit("qd:stream:unsub", WORLD_STREAM);
    }
  }
}

function waitForHello(connection: QuickdrawConnection): Promise<HelloFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error("the game server did not say hello"));
    }, CONNECT_TIMEOUT_MS);
    const off = connection.onHello((hello) => {
      clearTimeout(timeout);
      off();
      resolve(hello);
    });
  });
}
