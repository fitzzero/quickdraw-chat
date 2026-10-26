/**
 * The game client's wire (apps/web/src/game/wire/pageTransport.ts) against
 * the API's test app, over a real protocol 5 socket: it subscribes the world
 * stream and takes its seed as a keyframe, decodes each tick's snapshot,
 * sends input the sim steps, asks for a keyframe again, hears a player
 * leave, follows the server the hello names; in bench mode it joins the
 * world itself, and in the page's mode it takes the bounds from the join the
 * page made and leaves the stream when it closes.
 */

import { createQuickdrawConnection, callData } from "@fitzzero/quickdraw-core/client/core";
import type { QuickdrawConnection } from "@fitzzero/quickdraw-core/client/core";
import { resetDatabase, seedTestUsers, testDb } from "@project/db/testing";
import type {
  GameDeathEvent,
  GamePlayerMeta,
  GameWire,
  WorldBootstrap,
  WorldSnapshot,
} from "@project/shared";
import { GLOBAL_WORLD_ID, GLOBAL_WORLD_ROOM } from "@project/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApp, user, type ApiTestApp } from "../../../api/src/__tests__/utils/app";
import { ensureGlobalWorld } from "../../../api/src/services/game/bootstrap";
import { gameRuntime } from "../../../api/src/services/game/runtime";
import { PageTransport } from "../game/wire/pageTransport";

const WORLD = { worldId: GLOBAL_WORLD_ID };

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;
/** What a test opened: closed after it, so no socket stays in the world's room. */
let cleanups: (() => void)[] = [];

/** A wire that records what the transport hands it. */
interface Recorder extends GameWire {
  followed: string[];
  snapshots: WorldSnapshot[];
  keyframes: WorldSnapshot[];
  deaths: GameDeathEvent[];
  gone: string[];
}

function recorder(): Recorder {
  const r: Recorder = {
    followed: [],
    snapshots: [],
    keyframes: [],
    deaths: [],
    gone: [],
    follow: (serverId) => r.followed.push(serverId),
    snapshot: (snapshot) => r.snapshots.push(snapshot),
    keyframe: (keyframe) => r.keyframes.push(keyframe),
    death: (death) => r.deaths.push(death),
    left: (id) => r.gone.push(id),
  };
  return r;
}

/** A connection acting for `userId`, as the test app signs sockets in (anonymous for null). */
function connectionFor(userId: string | null): QuickdrawConnection {
  const connection = createQuickdrawConnection({
    url: app.url,
    auth: userId === null ? {} : { principal: user(userId) },
  });
  cleanups.push(() => connection.close());
  return connection;
}

/** One tick of the world: the loop pushes its snapshot to the stream. */
function tick(): number {
  const result = gameRuntime(testDb).loop.tickOnce();
  if (result === null) throw new Error("the loop did not tick");
  return result.snapshot.tick;
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
  await ensureGlobalWorld(testDb);
  const runtime = gameRuntime(testDb);
  for (const userId of runtime.playingUsers) runtime.sim.removePlayer(userId);
  runtime.playingUsers.clear();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await vi.waitFor(() => {
    expect(app.server.rooms.size(GLOBAL_WORLD_ROOM)).toBe(0);
  });
});

describe("PageTransport in bench mode (it joins the world itself)", () => {
  it("joins as its user, takes the seed as a keyframe and decodes each tick's snapshot", async () => {
    const players: GamePlayerMeta[] = [];
    const transport = new PageTransport({
      connection: connectionFor(users.regular.id),
      join: { kind: "self" },
      userId: users.regular.id,
      onPlayer: (meta) => players.push(meta),
    });
    cleanups.push(() => transport.close());
    const wire = recorder();
    const joined = await transport.start(wire, false);

    expect(joined.bounds.w).toBeGreaterThan(0);
    expect(joined.own?.id).toBe(users.regular.id);
    expect(wire.followed).toHaveLength(1);
    expect(players.map((p) => p.id)).toContain(users.regular.id);
    // the stream's seed: the world now, its food in one entry
    await vi.waitFor(() => expect(wire.keyframes.length).toBeGreaterThanOrEqual(1));
    expect(wire.keyframes[0]?.food?.[0]?.spawned?.length).toBeGreaterThan(0);

    // one tick at a time, as the game's loop runs them: one tick a timeout,
    // and a loop that falls a tick behind starts its grid again from now
    // (GameLoop.scheduleTick), so the world stream never pushes a burst
    const ticks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const sent = tick();
      await vi.waitFor(() => expect(wire.snapshots.map((s) => s.tick)).toContain(sent));
      ticks.push(sent);
    }
    expect(wire.snapshots.map((s) => s.tick)).toEqual(ticks);
    expect(wire.snapshots.at(-1)?.players.map((p) => p.id)).toContain(users.regular.id);
    expect(transport.needsKeyframe).toBe(false);
  });

  it("sends input the sim steps, and asks for a keyframe on request", async () => {
    const connection = connectionFor(users.regular.id);
    const transport = new PageTransport({
      connection,
      join: { kind: "self" },
      userId: users.regular.id,
    });
    cleanups.push(() => transport.close());
    const wire = recorder();
    const joined = await transport.start(wire, false);
    const ack = joined.own?.ack ?? 0;

    transport.sendInput([{ seq: ack + 1, dx: 1, dy: 0, boost: false }]);
    // the input is a volatile emit: the server reads it before the next call it answers
    await callData(connection, {
      service: "gameService",
      method: "getWorld",
      input: { slug: "global" },
    });
    tick();
    await vi.waitFor(() => {
      const own = wire.snapshots.at(-1)?.players.find((p) => p.id === users.regular.id);
      expect(own?.ack).toBe(ack + 1);
    });

    await vi.waitFor(() => expect(wire.keyframes.length).toBeGreaterThanOrEqual(1));
    const before = wire.keyframes.length;
    await transport.requestKeyframe();
    expect(wire.keyframes.length).toBe(before + 1);
  });

  it("hears a player join and leave", async () => {
    const players: GamePlayerMeta[] = [];
    const transport = new PageTransport({
      connection: connectionFor(users.regular.id),
      join: { kind: "self" },
      userId: users.regular.id,
      onPlayer: (meta) => players.push(meta),
    });
    cleanups.push(() => transport.close());
    const wire = recorder();
    await transport.start(wire, false);

    const other = await app.connect(user(users.moderator.id));
    await other.call.gameService.joinGame(WORLD);
    await vi.waitFor(() => expect(players.map((p) => p.id)).toContain(users.moderator.id));
    tick();
    await vi.waitFor(() =>
      expect(wire.snapshots.at(-1)?.players.map((p) => p.id)).toContain(users.moderator.id),
    );

    other.close();
    await vi.waitFor(() => expect(wire.gone).toContain(users.moderator.id));
  });
});

describe("PageTransport in the page's mode (the page joined the world)", () => {
  it("subscribes on the page's connection and takes the bounds from the page's join", async () => {
    const connection = connectionFor(null);
    connection.open();
    await vi.waitFor(() => expect(connection.getState().hello).not.toBeNull());
    // the page's useJoin(watchWorld): the socket is in the world's room, the bootstrap is the page's
    const bootstrap = await callData<WorldBootstrap>(connection, {
      service: "gameService",
      method: "watchWorld",
      input: WORLD,
    });
    const transport = new PageTransport({
      connection,
      join: { kind: "page", bootstrap: () => bootstrap },
      userId: null,
    });
    cleanups.push(() => transport.close());
    const wire = recorder();
    const joined = await transport.start(wire, true);

    expect(joined.bounds).toEqual(bootstrap.bounds);
    expect(joined.own).toBeUndefined();
    expect(wire.followed).toEqual([connection.getState().hello?.serverId]);
    await vi.waitFor(() => expect(wire.keyframes.length).toBeGreaterThanOrEqual(1));
    const first = tick();
    await vi.waitFor(() => expect(wire.snapshots.map((s) => s.tick)).toContain(first));
    // a spectator's transport never joins: closing it leaves the page's connection open
    let framesAfterClose = 0;
    connection.socket.on("qd:stream", () => {
      framesAfterClose += 1;
    });
    transport.close();
    expect(connection.getState().status).not.toBe("disconnected");

    // ...and leaves the world stream: the page's socket hears no more snapshots
    const getWorld = (): Promise<unknown> =>
      callData(connection, {
        service: "gameService",
        method: "getWorld",
        input: { slug: "global" },
      });
    await getWorld();
    tick();
    await getWorld();
    expect(framesAfterClose).toBe(0);
  });
});
