/**
 * The server's wire for a bot: quickdraw protocol v5 as the web client
 * speaks it (handshake → `qd:hello` → `qd:stream:sub` of the world stream →
 * joinGame/watchWorld, which puts the socket in the world's room → `qd:ch`
 * input → volatile `qd:stream` snapshots, packed, and `qd:event` world
 * events), through an optional latency proxy. Snapshots are unpacked with
 * one SnapshotDecoder: kept across resubscribes,
 * reset for another server's world.
 */

import { io as ioClient, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  type CallReply,
  type EventFrame,
  type HelloFrame,
  type StreamFrame,
  type StreamSubscribeReply,
} from "@fitzzero/quickdraw-core";
import type {
  GameBootstrap,
  GameDeathEvent,
  GameInput,
  GameJoin,
  GameTransport,
  GameWire,
  PackedWorldItem,
  WorldBootstrap,
} from "@project/shared";
import { GLOBAL_WORLD_ID, SnapshotDecoder } from "@project/shared";

const JOIN_TIMEOUT_MS = 15_000;
/** `auth.qd`: the protocol the bots speak, and who they are in the server's logs. */
const HANDSHAKE = { protocol: PROTOCOL_VERSION, client: "quickdraw-chat-bench/0.0.1" };
const WORLD = { worldId: GLOBAL_WORLD_ID };

/** Sends an acknowledged event and resolves with its acknowledgement. */
function request<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`bot ack timeout: ${event}`)),
      JOIN_TIMEOUT_MS,
    );
    socket.emit(event, payload, (reply: T) => {
      clearTimeout(timeout);
      resolve(reply);
    });
  });
}

/** `qd:call` of a gameService method: its data, or the call's error. */
async function callGame<T>(socket: Socket, id: number, method: string, input: unknown): Promise<T> {
  const reply = await request<CallReply<T>>(socket, "qd:call", {
    id,
    s: "gameService",
    m: method,
    i: input,
  });
  if (reply.ok && "d" in reply) return reply.d;
  throw new Error(
    reply.ok
      ? `bot call ${method}: not modified`
      : `bot call ${method}: ${reply.e.code} ${reply.e.message}`,
  );
}

export class SocketTransport implements GameTransport {
  private socket: Socket | null = null;
  /** Unpacks the world stream: kept across resubscribes, reset for another server's world. */
  private readonly decoder = new SnapshotDecoder();
  /** The server whose world the decoder holds the table of (its hello's `serverId`). */
  private serverId: string | null = null;
  private wire: GameWire | null = null;
  private nextCallId = 0;

  constructor(
    /** port to actually connect to (proxy port or the real server port) */
    private readonly port: number,
    private readonly userId: string,
    private readonly name: string,
  ) {}

  public get needsKeyframe(): boolean {
    return this.decoder.needsKeyframe;
  }

  public async start(wire: GameWire, spectator: boolean): Promise<GameJoin> {
    this.wire = wire;
    // Development credentials (`auth.userId`): the bench server's sign-in
    const socket = ioClient(`http://127.0.0.1:${this.port}`, {
      auth: { userId: this.userId, qd: HANDSHAKE },
      transports: ["websocket"],
      reconnection: false,
      autoConnect: true,
    });
    this.socket = socket;

    // The hello names the server, whose world the clock follows (a restarted
    // one starts its ticks over)
    socket.on("qd:hello", (hello: HelloFrame) => {
      // Another server's world (its ticks start over) has another id table
      if (hello.serverId !== this.serverId) this.decoder.reset();
      this.serverId = hello.serverId;
      wire.follow(hello.serverId);
    });
    // The server is ready for calls once it said hello
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`bot ${this.name}: connect timeout`)),
        JOIN_TIMEOUT_MS,
      );
      socket.once("qd:hello", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    socket.on("qd:stream", ([service, stream, , item]: StreamFrame) => {
      if (service === "gameService" && stream === "world") {
        wire.snapshot(this.decoder.decode((item as PackedWorldItem).b));
      }
    });
    socket.on("qd:event", ([service, event, payload]: EventFrame) => {
      if (service !== "gameService") return;
      if (event === "death") wire.death(payload as GameDeathEvent);
      // a player that left is dropped at once
      if (event === "playerLeft") wire.left((payload as { id: string }).id);
    });

    // Ordering contract: the world stream FIRST (its snapshots supersede the
    // bootstrap's after it), then join/watch, which puts this socket in the
    // world's room: its events, and the input channel's requirement.
    const subscribed = await this.subscribeWorld(socket);
    if (!subscribed.ok) throw new Error(`bot ${this.name}: ${subscribed.e.message}`);

    if (spectator) {
      const bootstrap = await callGame<WorldBootstrap>(socket, this.callId(), "watchWorld", WORLD);
      return { bounds: bootstrap.bounds };
    }
    const bootstrap = await callGame<GameBootstrap>(socket, this.callId(), "joinGame", WORLD);
    const own = bootstrap.snaps.find((s) => s.id === this.userId);
    return { bounds: bootstrap.bounds, ...(own ? { own } : {}) };
  }

  /**
   * Subscribes to the world stream; its seed (a keyframe) names every player
   * and replaces the food held.
   */
  private async subscribeWorld(socket: Socket): Promise<StreamSubscribeReply<PackedWorldItem>> {
    const reply = await request<StreamSubscribeReply<PackedWorldItem>>(socket, "qd:stream:sub", {
      s: "gameService",
      stream: "world",
      scope: GLOBAL_WORLD_ID,
    });
    if (reply.ok) for (const seed of reply.seed) this.wire?.keyframe(this.decoder.decode(seed.b));
    return reply;
  }

  /** A held feed subscribed again answers a fresh seed. */
  public async requestKeyframe(): Promise<void> {
    if (this.socket) await this.subscribeWorld(this.socket);
  }

  public sendInput(frames: GameInput[]): void {
    // `qd:ch`: fire and forget on Socket.IO's volatile flag, which drops a
    // message while the transport is still writing (a second send in the
    // same tick), backlog or not; the next message repeats a dropped one's
    // frames. useChannel drops one only on a real backlog since quickdraw
    // 5.1.4. channelOf (quickdraw card
    // `client-core-streams-channels-and-events-without-react-host-s`) brings
    // that rule here when it replaces the page's hand-written wire, which
    // this one follows
    this.socket?.volatile.emit("qd:ch", ["gameService", "input", { frames }]);
  }

  public respawn(): void {
    if (!this.socket) return;
    callGame(this.socket, this.callId(), "respawn", WORLD).catch(() => {
      // Respawn can race shutdown; the bot just stays dead
    });
  }

  public close(): void {
    this.socket?.close();
  }

  /** A call id no call in flight on this socket has. */
  private callId(): number {
    this.nextCallId += 1;
    return this.nextCallId;
  }
}
