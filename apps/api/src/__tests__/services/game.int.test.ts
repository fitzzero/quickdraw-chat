// The game's methods on 5.0. quickdraw-game: the game's realtime half (the
// world room, the input channel, the snapshot and event broadcasts, players
// anchored on their sockets, spectators, the admin screen) moves to the 5.0
// realtime kit with the game's own port (pack child 4); its cases are listed
// below as todos, which that port turns back into tests on the v5 wire.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { GLOBAL_WORLD_ID } from "@project/shared";
import { ensureGlobalWorld } from "../../services/game/bootstrap.js";
import { gameRuntime } from "../../services/game/runtime.js";
import { principalOf, startTestApp, type ApiTestApp } from "../utils/app.js";

const WORLD = { worldId: GLOBAL_WORLD_ID };

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;

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
  await ensureGlobalWorld(testPrisma);
  // Nobody plays at the start of a test (the sim outlives a database reset)
  const runtime = gameRuntime(testDb);
  for (const userId of runtime.playingUsers) {
    runtime.sim.removePlayer(userId);
  }
  runtime.playingUsers.clear();
});

async function as(userId: string): Promise<ReturnType<ApiTestApp["as"]>> {
  return app.as(await principalOf(userId));
}

describe("GameService", () => {
  it("joins: answers the full bootstrap and adds the player to the world chat", async () => {
    const bootstrap = await (await as(users.regular.id)).gameService.joinGame(WORLD);

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
    await (await as(users.regular.id)).gameService.joinGame(WORLD);
    const second = await (await as(users.moderator.id)).gameService.joinGame(WORLD);
    expect(second.players.map((p) => p.id)).toEqual(
      expect.arrayContaining([users.regular.id, users.moderator.id]),
    );
  });

  it("leaveGame takes the player out of the sim", async () => {
    const player = await as(users.moderator.id);
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
    await expect(
      (await as(users.regular.id)).gameService.joinGame({ worldId: "nope" }),
    ).rejects.toEqual(new QuickdrawError("NOT_FOUND", "Unknown world"));
  });
});

describe("GameService spectating and scores", () => {
  it("watchWorld answers the bootstrap without spawning, and adds the world chat", async () => {
    const before = gameRuntime(testDb).sim.playerCount();
    const world = await (await as(users.regular.id)).gameService.watchWorld(WORLD);

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
    const player = await as(users.regular.id);
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
      await (await as(users.regular.id)).gameService.joinGame(WORLD);

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

// quickdraw-game: the realtime cases, back with the game's 5.0 port (child 4)
describe("GameService on the 5.0 realtime kit (the game's port)", () => {
  it.todo("channel input moves the snake; the snapshot echoes the ack seq");
  it.todo("a second joiner arrives at the first player as a playerJoined event");
  it.todo("drops channel input from a socket that has not joined the world's room");
  it.todo("drops malformed channel payloads silently");
  it.todo("token-buckets channel floods without disconnecting the socket");
  it.todo("leaveGame broadcasts playerLeft");
  it.todo("a disconnect takes the player out of the sim");
  it.todo("any socket of the user in the world's room anchors the player (dual-socket presence)");
  it.todo("an anonymous spectator joins the world's room and receives snapshots");
  it.todo("service administrators list game worlds through the admin kit; others are refused");
});
