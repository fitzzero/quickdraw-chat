import { describe, expect, it } from "vitest";
import type { GameInput, PartyEvent, WorldSnapshot } from "../types/game.js";
import { GAME_TICK_RATE } from "../types/game.js";
import {
  FAIR_LINK_MAX_MS,
  PartyWorld,
  fairLinkMs,
  roundTrips,
  settleFairLink,
  type LaggablePeer,
  type LinkedPeer,
} from "./party.js";
import type { GameTunables, SnakeState } from "./world.js";

interface Party {
  world: PartyWorld;
  snapshots: WorldSnapshot[];
  events: PartyEvent[];
}

/** A party with no NPCs, and what it sent. */
function party(tunables: Partial<GameTunables> = {}): Party {
  const snapshots: WorldSnapshot[] = [];
  const events: PartyEvent[] = [];
  const world = new PartyWorld({
    seed: 7,
    tunables: { npcCount: 0, ...tunables },
    emit: {
      world: (snapshot): void => {
        snapshots.push(snapshot);
      },
      event: (event): void => {
        events.push(event);
      },
    },
  });
  return { world, snapshots, events };
}

function peer(userId: string, rtt: number, synced = true): LinkedPeer {
  return { userId, link: { clock: { rtt, synced } } };
}

/** A peer whose link records each lag the host gives it. */
function laggable(userId: string, rtt: number): LaggablePeer & { lags: ({ ms: number } | null)[] } {
  const lags: ({ ms: number } | null)[] = [];
  return {
    userId,
    lags,
    link: {
      clock: { rtt, synced: true },
      setLag: (lag): void => {
        lags.push(lag === null ? null : { ms: lag.ms });
      },
    },
  };
}

function frame(seq: number, dx: number, dy: number, boost = false): GameInput {
  return { seq, dx, dy, boost };
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to be defined");
  return value;
}

describe("PartyWorld", () => {
  it("spawns a player the server named once, sends a death, and respawns without a second join", () => {
    const { world, events } = party({ initialFood: 0, foodSpawnIntervalTicks: 100_000 });
    world.play("wall", "Wall");
    world.play("runner", "Runner");
    world.play("runner", "Runner");
    // Lay the wall's body along y = 500 and point the runner at it from 25 px
    // below, boosted: it hits it this tick (the sim's own snakes, as world.test.ts)
    const { players } = world.sim as unknown as { players: Map<string, SnakeState> };
    const wall = must(players.get("wall"));
    wall.path = Array.from({ length: 30 }, (_, i) => ({ x: 300 + i * 8, y: 500 }));
    wall.head = { x: 532, y: 500 };
    wall.dir = { x: 1, y: 0 };
    const runner = must(players.get("runner"));
    runner.head = { x: 420, y: 525 };
    runner.dir = { x: 0, y: -1 };
    runner.path = [{ ...runner.head }];
    world.input("wall", [frame(1, 1, 0)]);
    world.input(
      "runner",
      [1, 2, 3, 4].map((seq) => frame(seq, 0, -1, true)),
    );
    world.tick();
    expect(events).toContainEqual(expect.objectContaining({ kind: "death", id: "runner" }));
    expect(world.sim.isAlive("runner")).toBe(false);

    // the server's word again: the same snake, alive
    world.play("runner", "Runner");
    expect(world.sim.isAlive("runner")).toBe(true);
    expect(
      events.filter((e) => e.kind === "joined").map((e) => e.kind === "joined" && e.id),
    ).toEqual(["wall", "runner"]);
  });

  it("takes a player who left out, and says so once", () => {
    const { world, events } = party();
    world.play("ada", "Ada");
    world.leave("ada");
    world.leave("ada");
    expect(world.sim.hasPlayer("ada")).toBe(false);
    expect(events.filter((e) => e.kind === "left")).toEqual([{ kind: "left", id: "ada" }]);
  });

  it("sends a snapshot every tick and the leaderboard once a second, with the links' measures", () => {
    const { world, snapshots, events } = party();
    world.play("ada", "Ada");
    world.setLinks({ bo: 80 }, 40);
    for (let i = 0; i < GAME_TICK_RATE; i++) world.tick();
    expect(snapshots).toHaveLength(GAME_TICK_RATE);
    expect(snapshots.at(-1)?.players.map((p) => p.id)).toEqual(["ada"]);
    const boards = events.filter((e) => e.kind === "leaderboard");
    expect(boards).toEqual([
      {
        kind: "leaderboard",
        entries: [expect.objectContaining({ id: "ada", name: "Ada" })],
        rttMs: { bo: 80 },
        fairLinkMs: 40,
      },
    ]);
  });

  it("moves a player by their input, as the server's world does", () => {
    const { world, snapshots } = party();
    world.play("ada", "Ada");
    world.tick();
    const start = snapshots.at(-1)?.players[0];
    world.input("ada", [{ seq: 1, dx: 0, dy: 1, boost: false }]);
    world.tick();
    const moved = snapshots.at(-1)?.players[0];
    expect(moved?.ack).toBe(1);
    expect(moved?.y).not.toBe(start?.y);
  });

  it("seeds partyEvents with a join for every player and the latest leaderboard, and partyWorld with the world now", () => {
    const { world } = party();
    world.play("ada", "Ada");
    world.play("bo", null);
    const seed = world.seedEvents();
    expect(seed.filter((e) => e.kind === "joined").map((e) => e.kind === "joined" && e.id)).toEqual(
      ["ada", "bo"],
    );
    expect(seed.at(-1)).toEqual({ kind: "leaderboard", entries: [], rttMs: {}, fairLinkMs: null });
    const keyframe = world.keyframe();
    expect(keyframe.players.map((p) => p.id).sort()).toEqual(["ada", "bo"]);
    expect(keyframe.food).toHaveLength(1);
  });
});

describe("the fair link", () => {
  it("measures each user by the longest of its synced links", () => {
    expect(roundTrips([peer("ada", 10.4), peer("ada", 30.6), peer("bo", 99, false)])).toEqual({
      ada: 31,
    });
  });

  it("lags the host by the median of the others' one-way trips, never by its own links", () => {
    // the host's own link carries the lag: left out
    expect(fairLinkMs({ host: 400, ada: 40, bo: 80, cy: 120 }, "host")).toBe(40);
    // an even count takes the upper median, as core's matchPlayersLag does
    expect(fairLinkMs({ host: 0, ada: 40, bo: 80 }, "host")).toBe(40);
    expect(fairLinkMs({ ada: 20, bo: 100 }, "host")).toBe(50);
  });

  it("is 0 with nobody else linked, and at most FAIR_LINK_MAX_MS", () => {
    expect(fairLinkMs({ host: 30 }, "host")).toBe(0);
    expect(fairLinkMs({}, "host")).toBe(0);
    expect(fairLinkMs({ ada: 1_000 }, "host")).toBe(FAIR_LINK_MAX_MS);
  });

  it("lags both of the host user's links, and no player's, or ends their lag when off", () => {
    const game = laggable("host", 2);
    const page = laggable("host", 1);
    const ada = laggable("ada", 100);
    const bo = laggable("bo", 120);
    const peers = [game, page, ada, bo];

    expect(settleFairLink(peers, "host", true)).toEqual({
      rttMs: { host: 2, ada: 100, bo: 120 },
      fairLinkMs: 60,
    });
    expect(game.lags).toEqual([{ ms: 60 }]);
    expect(page.lags).toEqual([{ ms: 60 }]);
    expect(ada.lags).toEqual([]);
    expect(bo.lags).toEqual([]);

    expect(settleFairLink(peers, "host", false).fairLinkMs).toBeNull();
    expect(game.lags.at(-1)).toBeNull();
    expect(page.lags.at(-1)).toBeNull();
  });
});
