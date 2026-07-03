import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { GameBootstrap, WorldSnapshot } from "@project/shared";
import { GAME_EVENTS, GLOBAL_WORLD_ID } from "@project/shared";
import type { GameService } from "../../services/game/index.js";
import { ensureGlobalWorld } from "../../services/game/bootstrap.js";
import { startTestServer } from "../utils/server.js";
import { connectAnonymously, connectAsUser, emitWithAck, waitForEvent } from "../utils/socket.js";
import { createTestUser } from "../factories/user-factory.js";

const INPUT_EVENT = "channel:gameService:input";

/** Assert-and-narrow: fails the test instead of using non-null assertions. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be defined");
  return value;
}

function flush(ms = 60): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("GameService Integration", () => {
  let stop: () => Promise<void>;
  let port: number;
  let gameService: GameService;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
    gameService = server.gameService;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
    await ensureGlobalWorld(testPrisma);
  });

  async function subscribeAndJoin(userId: string) {
    const client = await connectAsUser(port, userId);
    // Order matters: subscribe first (room membership gates the input channel)
    await emitWithAck(client, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    const bootstrap = await emitWithAck<{ worldId: string }, GameBootstrap>(
      client,
      "gameService:joinGame",
      { worldId: GLOBAL_WORLD_ID },
    );
    return { client, bootstrap };
  }

  it("join returns full bootstrap and auto-joins the world chat", async () => {
    const { client, bootstrap } = await subscribeAndJoin(users.regular.id);

    expect(bootstrap.worldId).toBe(GLOBAL_WORLD_ID);
    expect(bootstrap.tickRate).toBe(20);
    expect(bootstrap.you.id).toBe(users.regular.id);
    expect(bootstrap.players.map((p) => p.id)).toContain(users.regular.id);
    expect(bootstrap.snaps.map((s) => s.id)).toContain(users.regular.id);
    expect(bootstrap.food.length).toBeGreaterThan(0);
    expect(bootstrap.bounds.w).toBeGreaterThan(0);
    expect(bootstrap.chatId).toBeTruthy();

    // Chat membership was upserted
    const member = await testPrisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: must(bootstrap.chatId), userId: users.regular.id } },
    });
    expect(member?.level).toBe("Read");

    client.close();
    await flush();
  });

  it("channel input moves the snake; snapshot echoes the ack seq", async () => {
    const { client, bootstrap } = await subscribeAndJoin(users.regular.id);
    const me = must(bootstrap.snaps.find((s) => s.id === users.regular.id));

    client.emit(INPUT_EVENT, { seq: 7, dx: 1, dy: 0, boost: false });
    await flush();

    const snapshotPromise = waitForEvent<WorldSnapshot>(client, GAME_EVENTS.snapshot);
    gameService.loop.tickOnce();
    const snapshot = await snapshotPromise;

    const mine = must(snapshot.players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(7);
    const moved = Math.hypot(mine.x - me.x, mine.y - me.y);
    expect(moved).toBeGreaterThan(0);

    client.close();
    await flush();
  });

  it("both players see each other; second joiner arrives via reliable event", async () => {
    const { client: a } = await subscribeAndJoin(users.regular.id);

    const joinedPromise = waitForEvent<{ id: string }>(a, GAME_EVENTS.playerJoined);
    const { client: b, bootstrap: bBootstrap } = await subscribeAndJoin(users.moderator.id);
    const joined = await joinedPromise;

    expect(joined.id).toBe(users.moderator.id);
    expect(bBootstrap.players.map((p) => p.id)).toEqual(
      expect.arrayContaining([users.regular.id, users.moderator.id]),
    );

    a.close();
    b.close();
    await flush();
  });

  it("drops channel input from a socket that has not subscribed to the world", async () => {
    const outsider = await connectAsUser(port, users.moderator.id);
    // Join via a subscribed socket so the player exists in the sim
    const { client: insider, bootstrap } = await subscribeAndJoin(users.regular.id);
    const before = must(bootstrap.snaps.find((s) => s.id === users.regular.id));

    // The outsider spoofs input for their own (never-joined) player AND floods —
    // nothing should reach the sim because they're not in the world room
    outsider.emit(INPUT_EVENT, { seq: 1, dx: 1, dy: 0, boost: false });
    await flush();

    const snapshotPromise = waitForEvent<WorldSnapshot>(insider, GAME_EVENTS.snapshot);
    gameService.loop.tickOnce();
    const snapshot = await snapshotPromise;

    const mine = must(snapshot.players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(before.ack); // untouched — outsider input dropped

    outsider.close();
    insider.close();
    await flush();
  });

  it("drops malformed channel payloads silently", async () => {
    const { client } = await subscribeAndJoin(users.regular.id);

    client.emit(INPUT_EVENT, { seq: "nope", dx: "x" });
    client.emit(INPUT_EVENT, null);
    client.emit(INPUT_EVENT, "garbage");
    await flush();

    const snapshotPromise = waitForEvent<WorldSnapshot>(client, GAME_EVENTS.snapshot);
    gameService.loop.tickOnce();
    const snapshot = await snapshotPromise;

    const mine = must(snapshot.players.find((p) => p.id === users.regular.id));
    expect(mine.ack).toBe(0); // nothing applied
    expect(client.connected).toBe(true);

    client.close();
    await flush();
  });

  it("token-buckets channel floods without disconnecting the socket", async () => {
    const { client } = await subscribeAndJoin(users.regular.id);

    for (let i = 1; i <= 500; i++) {
      client.emit(INPUT_EVENT, { seq: i, dx: 1, dy: 0, boost: false });
    }
    await flush(150);

    const snapshotPromise = waitForEvent<WorldSnapshot>(client, GAME_EVENTS.snapshot);
    gameService.loop.tickOnce();
    const snapshot = await snapshotPromise;

    const mine = must(snapshot.players.find((p) => p.id === users.regular.id));
    // Some frames applied (up to burst), far from all 500
    expect(mine.ack).toBeGreaterThan(0);
    expect(mine.ack).toBeLessThan(500);
    expect(client.connected).toBe(true);

    client.close();
    await flush();
  });

  it("leaveGame removes the player and broadcasts playerLeft", async () => {
    const { client: a } = await subscribeAndJoin(users.regular.id);
    const { client: b } = await subscribeAndJoin(users.moderator.id);

    const leftPromise = waitForEvent<{ id: string }>(a, GAME_EVENTS.playerLeft);
    await emitWithAck(b, "gameService:leaveGame", { worldId: GLOBAL_WORLD_ID });
    const left = await leftPromise;

    expect(left.id).toBe(users.moderator.id);
    expect(gameService.sim.hasPlayer(users.moderator.id)).toBe(false);

    a.close();
    b.close();
    await flush();
  });

  it("disconnect removes the player from the sim", async () => {
    const { client } = await subscribeAndJoin(users.regular.id);
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(true);

    client.close();
    await flush(150);

    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(false);
  });

  it("getWorld is public and returns world info by slug", async () => {
    const client = await connectAsUser(port, users.regular.id);
    const world = await emitWithAck<{ slug: string }, { id: string; chatId: string | null }>(
      client,
      "gameService:getWorld",
      { slug: "global" },
    );

    expect(world.id).toBe(GLOBAL_WORLD_ID);
    expect(world.chatId).toBeTruthy();

    client.close();
    await flush();
  });

  it("rejects joining an unknown world", async () => {
    const client = await connectAsUser(port, users.regular.id);
    await emitWithAck(client, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });

    await expect(emitWithAck(client, "gameService:joinGame", { worldId: "nope" })).rejects.toThrow(
      "Unknown world",
    );

    client.close();
    await flush();
  });

  it("admin can list game worlds; regular user cannot", async () => {
    const gameAdmin = await createTestUser({ serviceAccess: { gameService: "Admin" } });
    const admin = await connectAsUser(port, gameAdmin.id);
    const regular = await connectAsUser(port, users.regular.id);

    const list = await emitWithAck<Record<string, unknown>, { items: { id: string }[] }>(
      admin,
      "gameService:adminList",
      {},
    );
    expect(list.items.map((w) => w.id)).toContain(GLOBAL_WORLD_ID);

    await expect(emitWithAck(regular, "gameService:adminList", {})).rejects.toThrow();

    admin.close();
    regular.close();
    await flush();
  });
});

describe("GameService spectate, presence, and scores", () => {
  let stop: () => Promise<void>;
  let port: number;
  let gameService: GameService;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
    gameService = server.gameService;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
    await ensureGlobalWorld(testPrisma);
  });

  it("watchWorld returns the bootstrap without spawning", async () => {
    const client = await connectAsUser(port, users.regular.id);
    await emitWithAck(client, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });

    const before = gameService.sim.playerCount();
    const world = await emitWithAck<
      { worldId: string },
      { snaps: { id: string }[]; chatId: string | null }
    >(client, "gameService:watchWorld", { worldId: GLOBAL_WORLD_ID });

    expect(gameService.sim.playerCount()).toBe(before);
    expect(world.snaps.map((s) => s.id)).not.toContain(users.regular.id);
    expect(world.chatId).toBeTruthy();
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(false);

    // Spectators get world-chat membership (the overlay works pre-join)
    const membership = await testPrisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: world.chatId as string, userId: users.regular.id } },
    });
    expect(membership?.level).toBe("Read");

    client.close();
    await flush();
  });

  it("anonymous spectators get the world via Public watchWorld", async () => {
    const anon = await connectAnonymously(port);

    // subscribe is auth-gated at the registry
    await expect(
      emitWithAck(anon, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID }),
    ).rejects.toThrow(/Authentication required/);

    // ...but the Public watchWorld returns the bootstrap AND grants
    // world-room membership (joinSpectator) without spawning anything
    const world = await emitWithAck<{ worldId: string }, { chatId: string | null; tick: number }>(
      anon,
      "gameService:watchWorld",
      { worldId: GLOBAL_WORLD_ID },
    );
    expect(world.chatId).toBeTruthy();
    expect(gameService.sim.playerCount()).toBe(0);
    await flush();

    // A lone anonymous spectator counts as audience (the sim keeps ticking)
    // and receives the volatile snapshot stream through room membership
    const snapshotPromise = waitForEvent<WorldSnapshot>(anon, GAME_EVENTS.snapshot);
    const result = gameService.loop.tickOnce();
    expect(result).not.toBeNull();
    const snapshot = await snapshotPromise;
    expect(snapshot.tick).toBeGreaterThan(0);

    // Disconnect cleans the spectator out of the audience
    anon.close();
    await flush(150);
    expect(gameService.loop.tickOnce()).toBeNull();
  });

  it("dual-socket presence: any subscribed socket of the user anchors the player", async () => {
    // Socket A = "Godot" (subscribes only), socket B = "React page" (joins)
    const godot = await connectAsUser(port, users.regular.id);
    const page = await connectAsUser(port, users.regular.id);
    await emitWithAck(godot, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    await emitWithAck(page, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    await emitWithAck(page, "gameService:joinGame", { worldId: GLOBAL_WORLD_ID });

    // The joining socket dies (page reload) — the Godot socket keeps the player alive
    page.close();
    await flush(150);
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(true);

    // Last socket gone → player removed
    godot.close();
    await flush(150);
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(false);
  });

  it("explicit unsubscribe also releases presence (no player leak)", async () => {
    const a = await connectAsUser(port, users.regular.id);
    const b = await connectAsUser(port, users.regular.id);
    await emitWithAck(a, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    await emitWithAck(b, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    await emitWithAck(b, "gameService:joinGame", { worldId: GLOBAL_WORLD_ID });

    await emitWithAck(b, "gameService:unsubscribe", { entryId: GLOBAL_WORLD_ID });
    await flush();
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(true);

    await emitWithAck(a, "gameService:unsubscribe", { entryId: GLOBAL_WORLD_ID });
    await flush();
    expect(gameService.sim.hasPlayer(users.regular.id)).toBe(false);

    a.close();
    b.close();
    await flush();
  });

  it("getMyBest returns 0 without a score and the persisted best with one", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const empty = await emitWithAck<{ worldId: string }, { bestLength: number }>(
      client,
      "gameService:getMyBest",
      { worldId: GLOBAL_WORLD_ID },
    );
    expect(empty.bestLength).toBe(0);

    await testPrisma.gameScore.create({
      data: { worldId: GLOBAL_WORLD_ID, userId: users.regular.id, bestLength: 42 },
    });
    const withScore = await emitWithAck<{ worldId: string }, { bestLength: number }>(
      client,
      "gameService:getMyBest",
      { worldId: GLOBAL_WORLD_ID },
    );
    expect(withScore.bestLength).toBe(42);

    client.close();
    await flush();
  });

  it("getHighScores is public, ordered, limited, and joins user info", async () => {
    await testPrisma.gameScore.createMany({
      data: [
        { worldId: GLOBAL_WORLD_ID, userId: users.regular.id, bestLength: 10 },
        { worldId: GLOBAL_WORLD_ID, userId: users.moderator.id, bestLength: 30 },
        { worldId: GLOBAL_WORLD_ID, userId: users.admin.id, bestLength: 20 },
      ],
    });

    const client = await connectAsUser(port, users.regular.id);
    const scores = await emitWithAck<
      { worldId: string; limit?: number },
      { userId: string; name: string | null; bestLength: number; isGuest: boolean }[]
    >(client, "gameService:getHighScores", { worldId: GLOBAL_WORLD_ID, limit: 2 });

    expect(scores).toHaveLength(2);
    expect(scores[0]?.bestLength).toBe(30);
    expect(scores[1]?.bestLength).toBe(20);
    expect(scores[0]?.name).toBeTruthy();
    expect(scores[0]?.isGuest).toBe(false);

    client.close();
    await flush();
  });

  it("NPC deaths never create GameScore rows", async () => {
    // Force NPCs on in a cramped world via live tunables, run ticks until an
    // NPC dies, then confirm nothing was persisted for npc ids.
    gameService.sim.applyTunables({ npcCount: 3, worldWidth: 450, worldHeight: 450 });
    const client = await connectAsUser(port, users.regular.id);
    await emitWithAck(client, "gameService:subscribe", { entryId: GLOBAL_WORLD_ID });
    await emitWithAck(client, "gameService:joinGame", { worldId: GLOBAL_WORLD_ID });

    let sawNpcDeath = false;
    for (let i = 0; i < 3000 && !sawNpcDeath; i++) {
      const result = gameService.loop.tickOnce();
      if (result?.deaths.some((d) => d.id.startsWith("npc-"))) sawNpcDeath = true;
    }
    expect(sawNpcDeath).toBe(true);
    await flush(200);

    const npcScores = await testPrisma.gameScore.findMany({
      where: { userId: { startsWith: "npc-" } },
    });
    expect(npcScores).toHaveLength(0);

    gameService.sim.applyTunables({ npcCount: 0, worldWidth: 2400, worldHeight: 2400 });
    client.close();
    await flush();
  });
});
