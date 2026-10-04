// The game on 5.0: its methods in process, and its realtime half over real
// protocol 5 sockets (the world's room, the input channel, the world stream,
// the world's events, players anchored on their sockets, spectators) and the
// admin kit.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { QuickdrawError, type EventFrame, type StreamFrame } from "@fitzzero/quickdraw-core";
import { emitWithAck } from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { GameBootstrap, WorldSnapshot } from "@project/shared";
import { GLOBAL_WORLD_ID, GLOBAL_WORLD_ROOM, GLOBAL_WORLD_SLUG } from "@project/shared";
import { ensureGlobalWorld } from "../../services/game/bootstrap.js";
import { gameRuntime } from "../../services/game/runtime.js";
import { createTestUser } from "../factories/user-factory.js";
import { startTestApp, type ApiConnection, type ApiTestApp } from "../utils/app.js";

const WORLD = { worldId: GLOBAL_WORLD_ID };

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;
/** The sockets a test opened: closed after it, so none stays in the world's room. */
let opened: ApiConnection[] = [];

/** Assert-and-narrow: fails the test instead of using non-null assertions. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be defined");
  return value;
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
  // Nobody plays at the start of a test (the sim outlives a database reset)
  const runtime = gameRuntime(testDb);
  for (const userId of runtime.playingUsers) {
    runtime.sim.removePlayer(userId);
  }
  runtime.playingUsers.clear();
});

afterEach(async () => {
  for (const connection of opened) connection.close();
  opened = [];
  // Every socket has left the world's room (the server heard the disconnects)
  await vi.waitFor(() => {
    expect(app.server.io.sockets.adapter.rooms.get(GLOBAL_WORLD_ROOM)?.size ?? 0).toBe(0);
  });
});

function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

/** A real protocol 5 socket acting for `userId` (anonymous for `null`). */
async function connect(userId: string | null): Promise<ApiConnection> {
  const connection = await app.connect(userId === null ? null : { userId });
  opened.push(connection);
  return connection;
}

/** A socket that joined the game: it is in the world's room, and its user plays. */
async function joined(
  userId: string,
): Promise<{ socket: ApiConnection; bootstrap: GameBootstrap }> {
  const socket = await connect(userId);
  return { socket, bootstrap: await socket.call.gameService.joinGame(WORLD) };
}

/** One message on the input channel: `qd:ch`, never answered. */
function sendInput(connection: ApiConnection, payload: unknown): void {
  connection.socket.emit("qd:ch", ["gameService", "input", payload]);
}

/** Resolves once the server read everything the socket sent before (a socket's events keep their order). */
async function settled(connection: ApiConnection): Promise<void> {
  await connection.call.gameService.getWorld({ slug: GLOBAL_WORLD_SLUG });
}

/** Subscribes the socket to the world stream; answers the seed. */
async function subscribeWorld(connection: ApiConnection): Promise<WorldSnapshot[]> {
  const reply = await emitWithAck<{ ok: boolean; seed?: WorldSnapshot[] }>(
    connection.socket,
    "qd:stream:sub",
    { s: "gameService", stream: "world", scope: GLOBAL_WORLD_ID },
  );
  expect(reply.ok).toBe(true);
  return reply.seed ?? [];
}

/** Runs one tick of the world; answers the snapshot `connection` received on the world stream. */
// quickdraw-5.0 finding: app.frames.waitFor is typed by event only for a query object; a predicate (this frame, this tick) gets untyped data, so every realtime test casts StreamFrame/EventFrame by hand
async function tickTo(connection: ApiConnection): Promise<WorldSnapshot> {
  const tick = must(gameRuntime(testDb).loop.tickOnce()).snapshot.tick;
  const frame = await app.frames.waitFor((recorded) => {
    const data = recorded.data as StreamFrame;
    return (
      recorded.event === "qd:stream" &&
      recorded.socketId === connection.socket.id &&
      (data.item as WorldSnapshot).tick === tick
    );
  });
  return (frame.data as StreamFrame).item as WorldSnapshot;
}

/** The next `event` of the world `connection` receives (one received already counts). */
async function worldEvent<T>(
  connection: ApiConnection,
  event: string,
  match: (payload: T) => boolean,
): Promise<T> {
  const frame = await app.frames.waitFor((recorded) => {
    if (recorded.event !== "qd:event" || recorded.socketId !== connection.socket.id) return false;
    const [service, name, payload] = recorded.data as EventFrame;
    return service === "gameService" && name === event && match(payload as T);
  });
  return (frame.data as EventFrame)[2] as T;
}

describe("GameService", () => {
  it("joins: answers the full bootstrap and adds the player to the world chat", async () => {
    const bootstrap = await as(users.regular.id).gameService.joinGame(WORLD);

    expect(bootstrap.worldId).toBe(GLOBAL_WORLD_ID);
    expect(bootstrap.tickRate).toBe(20);
    expect(bootstrap.you.id).toBe(users.regular.id);
    expect(bootstrap.players.map((p) => p.id)).toContain(users.regular.id);
    expect(bootstrap.snaps.map((s) => s.id)).toContain(users.regular.id);
    expect(bootstrap.food.length).toBeGreaterThan(0);
    expect(bootstrap.bounds.w).toBeGreaterThan(0);
    expect(bootstrap.chatId).toBeTruthy();

    const member = await testPrisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: must(bootstrap.chatId), userId: users.regular.id } },
    });
    expect(member?.level).toBe("Read");
  });

  it("answers the second joiner a bootstrap with both players", async () => {
    await as(users.regular.id).gameService.joinGame(WORLD);
    const second = await as(users.moderator.id).gameService.joinGame(WORLD);
    expect(second.players.map((p) => p.id)).toEqual(
      expect.arrayContaining([users.regular.id, users.moderator.id]),
    );
  });

  it("leaveGame takes the player out of the sim", async () => {
    const player = as(users.moderator.id);
    await player.gameService.joinGame(WORLD);
    expect(gameRuntime(testDb).sim.hasPlayer(users.moderator.id)).toBe(true);

    expect(await player.gameService.leaveGame(WORLD)).toEqual({ ok: true });
    expect(gameRuntime(testDb).sim.hasPlayer(users.moderator.id)).toBe(false);
  });

  it("getWorld is public and answers the world by its slug", async () => {
    const world = await app.as(null).gameService.getWorld({ slug: "global" });
    expect(world?.id).toBe(GLOBAL_WORLD_ID);
    expect(world?.chatId).toBeTruthy();
  });

  it("refuses an unknown world with NOT_FOUND", async () => {
    await expect(as(users.regular.id).gameService.joinGame({ worldId: "nope" })).rejects.toEqual(
      new QuickdrawError("NOT_FOUND", "Unknown world"),
    );
  });
});

describe("GameService spectating and scores", () => {
  it("watchWorld answers the bootstrap without spawning, and adds the world chat", async () => {
    const before = gameRuntime(testDb).sim.playerCount();
    const world = await as(users.regular.id).gameService.watchWorld(WORLD);

    expect(gameRuntime(testDb).sim.playerCount()).toBe(before);
    expect(world.snaps.map((s) => s.id)).not.toContain(users.regular.id);
    // Spectators get world-chat membership (the overlay works pre-join)
    const membership = await testPrisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: must(world.chatId), userId: users.regular.id } },
    });
    expect(membership?.level).toBe("Read");
  });

  it("watchWorld is public: an anonymous visitor gets the world", async () => {
    const world = await app.as(null).gameService.watchWorld(WORLD);
    expect(world.chatId).toBeTruthy();
    expect(gameRuntime(testDb).sim.playerCount()).toBe(0);
  });

  it("getMyBest answers 0 without a score and the stored best with one", async () => {
    const player = as(users.regular.id);
    expect(await player.gameService.getMyBest(WORLD)).toEqual({ bestLength: 0 });

    await testPrisma.gameScore.create({
      data: { worldId: GLOBAL_WORLD_ID, userId: users.regular.id, bestLength: 42 },
    });
    expect(await player.gameService.getMyBest(WORLD)).toEqual({ bestLength: 42 });
  });

  it("getHighScores is public, ordered, limited, and joins user info", async () => {
    await testPrisma.gameScore.createMany({
      data: [
        { worldId: GLOBAL_WORLD_ID, userId: users.regular.id, bestLength: 10 },
        { worldId: GLOBAL_WORLD_ID, userId: users.moderator.id, bestLength: 30 },
        { worldId: GLOBAL_WORLD_ID, userId: users.admin.id, bestLength: 20 },
      ],
    });

    const scores = await app.as(null).gameService.getHighScores({ ...WORLD, limit: 2 });
    expect(scores.map((s) => s.bestLength)).toEqual([30, 20]);
    expect(scores[0]?.name).toBeTruthy();
    expect(scores[0]?.isGuest).toBe(false);
  });

  it("never stores a score for an NPC's death", async () => {
    // Force NPCs on in a cramped world, run ticks until an NPC dies, then
    // confirm nothing was persisted for npc ids.
    const runtime = gameRuntime(testDb);
    runtime.sim.applyTunables({ npcCount: 3, worldWidth: 450, worldHeight: 450 });
    try {
      await as(users.regular.id).gameService.joinGame(WORLD);

      let sawNpcDeath = false;
      for (let i = 0; i < 3000 && !sawNpcDeath; i++) {
        const result = runtime.loop.tickOnce();
        if (result?.deaths.some((d) => d.id.startsWith("npc-"))) sawNpcDeath = true;
      }
      expect(sawNpcDeath).toBe(true);
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });

      const npcScores = await testPrisma.gameScore.findMany({
        where: { userId: { startsWith: "npc-" } },
      });
      expect(npcScores).toHaveLength(0);
    } finally {
      runtime.sim.applyTunables({ npcCount: 0, worldWidth: 2400, worldHeight: 2400 });
    }
  });
});

describe("GameService on the realtime kit", () => {
  it("channel input moves the snake; the snapshot echoes the ack seq", async () => {
    const { socket, bootstrap } = await joined(users.regular.id);
    const me = must(bootstrap.snaps.find((s) => s.id === users.regular.id));
    // the seed is the latest snapshot: every snake, at once
    await subscribeWorld(socket);

    sendInput(socket, { seq: 7, dx: 1, dy: 0, boost: false });
    await settled(socket);
    const snapshot = await tickTo(socket);

    const mine = must(snapshot.players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(7);
    expect(Math.hypot(mine.x - me.x, mine.y - me.y)).toBeGreaterThan(0);
    expect(typeof snapshot.t).toBe("number");
    // a later subscriber's seed is that snapshot
    const late = await connect(users.moderator.id);
    expect((await subscribeWorld(late)).map((seeded) => seeded.tick)).toEqual([snapshot.tick]);
  });

  it("a second joiner arrives at the first player as a playerJoined event", async () => {
    const { socket: first } = await joined(users.regular.id);
    const { bootstrap } = await joined(users.moderator.id);

    const meta = await worldEvent<{ id: string; hue: number }>(
      first,
      "playerJoined",
      (payload) => payload.id === users.moderator.id,
    );
    expect(typeof meta.hue).toBe("number");
    expect(bootstrap.players.map((p) => p.id)).toEqual(
      expect.arrayContaining([users.regular.id, users.moderator.id]),
    );
  });

  it("drops channel input from a socket that has not joined the world's room", async () => {
    const { socket: inside } = await joined(users.regular.id);
    await subscribeWorld(inside);
    // The same user's second socket never called watchWorld or joinGame: the
    // requirement is the sending socket's own, so its input is dropped
    const outside = await connect(users.regular.id);
    sendInput(outside, { seq: 5, dx: 1, dy: 0, boost: false });
    await settled(outside);
    let mine = must((await tickTo(inside)).players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(0);

    sendInput(inside, { seq: 6, dx: 1, dy: 0, boost: false });
    await settled(inside);
    mine = must((await tickTo(inside)).players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(6);
  });

  it("drops malformed channel payloads silently", async () => {
    const { socket } = await joined(users.regular.id);
    await subscribeWorld(socket);

    sendInput(socket, { seq: "nope", dx: "x" });
    sendInput(socket, null);
    sendInput(socket, "garbage");
    sendInput(socket, { seq: -1, dx: 1, dy: 0, boost: false });
    await settled(socket);

    const mine = must((await tickTo(socket)).players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(0);
    expect(socket.socket.connected).toBe(true);
  });

  it("token-buckets channel floods without disconnecting the socket", async () => {
    const { socket } = await joined(users.regular.id);
    await subscribeWorld(socket);

    for (let seq = 1; seq <= 500; seq++) {
      sendInput(socket, { seq, dx: 1, dy: 0, boost: false });
    }
    await settled(socket);

    const mine = must((await tickTo(socket)).players.find((p) => p.id === users.regular.id));
    // the burst (3 ticks' worth, 60 frames) went through, the rest was dropped
    expect(mine.ack).toBeGreaterThan(0);
    expect(mine.ack).toBeLessThan(500);
    expect(socket.socket.connected).toBe(true);
  });

  it("leaveGame broadcasts playerLeft", async () => {
    const { socket: stays } = await joined(users.regular.id);
    const { socket: leaves } = await joined(users.moderator.id);

    expect(await leaves.call.gameService.leaveGame(WORLD)).toEqual({ ok: true });

    await worldEvent<{ id: string }>(stays, "playerLeft", (left) => left.id === users.moderator.id);
    expect(gameRuntime(testDb).sim.hasPlayer(users.moderator.id)).toBe(false);
    // the socket stays in the world's room, spectating
    await worldEvent<{ id: string }>(
      leaves,
      "playerLeft",
      (left) => left.id === users.moderator.id,
    );
  });

  it("a disconnect takes the player out of the sim", async () => {
    const { socket: watcher } = await joined(users.regular.id);
    const { socket } = await joined(users.moderator.id);
    expect(gameRuntime(testDb).sim.hasPlayer(users.moderator.id)).toBe(true);

    socket.close();

    await worldEvent<{ id: string }>(
      watcher,
      "playerLeft",
      (left) => left.id === users.moderator.id,
    );
    expect(gameRuntime(testDb).sim.hasPlayer(users.moderator.id)).toBe(false);
    expect(gameRuntime(testDb).sim.hasPlayer(users.regular.id)).toBe(true);
  });

  it("any socket of the user in the world's room anchors the player (dual-socket presence)", async () => {
    // The Godot client spectates on its own socket; the web page joins on another
    const godot = await connect(users.regular.id);
    await godot.call.gameService.watchWorld(WORLD);
    const { socket: page } = await joined(users.regular.id);

    // The page reloads: the Godot socket keeps the player in the world
    page.close();
    await vi.waitFor(() => {
      expect(app.server.io.sockets.adapter.rooms.get(GLOBAL_WORLD_ROOM)?.size).toBe(1);
    });
    await settled(godot);
    expect(gameRuntime(testDb).sim.hasPlayer(users.regular.id)).toBe(true);

    // The last socket gone: the player leaves the sim
    godot.close();
    await vi.waitFor(() => {
      expect(gameRuntime(testDb).sim.hasPlayer(users.regular.id)).toBe(false);
    });
  });

  it("an anonymous spectator joins the world's room and receives snapshots", async () => {
    const runtime = gameRuntime(testDb);
    expect(runtime.loop.tickOnce()).toBeNull();

    const spectator = await connect(null);
    const world = await spectator.call.gameService.watchWorld(WORLD);
    expect(world.chatId).toBeTruthy();
    expect(runtime.sim.playerCount()).toBe(0);
    await subscribeWorld(spectator);

    // A lone anonymous spectator is an audience: the world keeps ticking, and
    // its snapshots reach them
    const snapshot = await tickTo(spectator);
    expect(snapshot.tick).toBeGreaterThan(0);
    // ...but an anonymous socket never steers anything: channels need a principal
    sendInput(spectator, { seq: 1, dx: 1, dy: 0, boost: false });
    await settled(spectator);
    expect(spectator.socket.connected).toBe(true);

    // The spectator leaves: nobody watches, the world freezes again
    spectator.close();
    await vi.waitFor(() => {
      expect(app.server.io.sockets.adapter.rooms.get(GLOBAL_WORLD_ROOM)?.size ?? 0).toBe(0);
    });
    expect(runtime.loop.tickOnce()).toBeNull();
  });

  it("service administrators list game worlds through the admin kit; others are refused", async () => {
    const gameAdmin = await createTestUser({ serviceAccess: { gameService: "Admin" } });

    const list = await as(gameAdmin.id).gameService.adminList({});
    expect(list.items.map((world) => world.id)).toContain(GLOBAL_WORLD_ID);
    const renamed = await as(gameAdmin.id).gameService.adminUpdate({
      id: GLOBAL_WORLD_ID,
      data: { name: "Snake — Renamed" },
    });
    expect(renamed.name).toBe("Snake — Renamed");

    await expect(as(users.regular.id).gameService.adminList({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // a chat Admin holds no grant on the game
    await expect(as(users.admin.id).gameService.adminList({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
