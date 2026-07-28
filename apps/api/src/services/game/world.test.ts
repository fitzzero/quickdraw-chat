import { describe, it, expect } from "vitest";
import type { GameInput } from "@project/shared";
import { GameWorldSim, DEFAULT_TUNABLES } from "./world.js";

function makeSim(overrides?: Partial<typeof DEFAULT_TUNABLES>): GameWorldSim {
  // NPCs off by default — these tests assert exact player/food counts.
  // Dedicated NPC behavior tests opt back in below.
  return new GameWorldSim({ seed: 7, tunables: { npcCount: 0, ...overrides } });
}

/** Assert-and-narrow: fails the test instead of using non-null assertions. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be defined");
  return value;
}

function input(seq: number, dx: number, dy: number, boost = false): GameInput {
  return { seq, dx, dy, boost };
}

describe("GameWorldSim", () => {
  it("is deterministic: same seed + same inputs → identical state", () => {
    const a = makeSim();
    const b = makeSim();
    a.addPlayer("p1", "Player");
    b.addPlayer("p1", "Player");

    for (let i = 1; i <= 50; i++) {
      a.applyInput("p1", input(i, 1, 0.5));
      b.applyInput("p1", input(i, 1, 0.5));
      a.step();
      b.step();
    }

    expect(a.getHead("p1")).toEqual(b.getHead("p1"));
    expect(a.tick).toBe(b.tick);
  });

  it("moves the snake at baseSpeed along its direction", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    const before = must(sim.getHead("p1"));

    // Aim exactly where the snake already points so no turning occurs
    const snap = must(sim.step().snapshot.players[0]);
    sim.applyInput("p1", input(1, snap.dx, snap.dy));
    const start = must(sim.getHead("p1"));
    sim.step();
    const after = must(sim.getHead("p1"));

    const moved = Math.hypot(after.x - start.x, after.y - start.y);
    expect(moved).toBeCloseTo(DEFAULT_TUNABLES.baseSpeed * sim.dt, 5);
    expect(before).not.toEqual(after);
  });

  it("clamps turning to turnRate per tick", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    const first = must(sim.step().snapshot.players[0]);

    // Demand a full reversal; the sim may only turn turnRate*dt per tick
    sim.applyInput("p1", input(1, -first.dx, -first.dy));
    const next = must(sim.step().snapshot.players[0]);

    const angleBefore = Math.atan2(first.dy, first.dx);
    const angleAfter = Math.atan2(next.dy, next.dx);
    let delta = Math.abs(angleAfter - angleBefore);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;

    // Small tolerance: snapshot dx/dy are quantized to 3 decimals
    expect(delta).toBeLessThanOrEqual(DEFAULT_TUNABLES.turnRate * sim.dt + 0.01);
    expect(delta).toBeGreaterThan(0);
  });

  it("burns length while boosting and never below minLength", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    const startLen = must(sim.getLength("p1"));

    for (let i = 1; i <= 200; i++) {
      sim.applyInput("p1", input(i, 1, 0, true));
      sim.step();
    }

    const len = must(sim.getLength("p1"));
    expect(len).toBeLessThan(startLen);
    expect(len).toBeGreaterThanOrEqual(DEFAULT_TUNABLES.minLength);
  });

  it("acknowledges the last applied input seq and ignores stale seqs", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);

    sim.applyInput("p1", input(5, 1, 0));
    sim.applyInput("p1", input(3, 0, 1)); // stale — must be ignored
    const snap = must(sim.step().snapshot.players[0]);

    expect(snap.ack).toBe(5);
  });

  it("grows when eating food", () => {
    // Deterministic setup: tiny world so the snake plows through food
    const sim = makeSim({ initialFood: 40, worldWidth: 400, worldHeight: 400 });
    sim.addPlayer("p1", null);
    const startLen = must(sim.getLength("p1"));

    let ate = false;
    for (let i = 1; i <= 300 && !ate; i++) {
      // Sweep in a spiral-ish pattern to cross food positions
      const angle = i * 0.15;
      sim.applyInput("p1", input(i, Math.cos(angle), Math.sin(angle)));
      const result = sim.step();
      if (result.snapshot.foodEaten?.length) ate = true;
    }

    expect(ate).toBe(true);
    expect(must(sim.getLength("p1"))).toBeGreaterThan(startLen);
  });

  it("kills a snake whose head hits a foreign body and drops food", () => {
    const sim = makeSim({ initialFood: 0, foodSpawnIntervalTicks: 100000 });
    sim.addPlayer("hunter", null);
    sim.addPlayer("wall", null);

    // Build up a body for "wall" by driving it straight for a while
    for (let i = 1; i <= 40; i++) {
      sim.applyInput("wall", input(i, 1, 0));
      sim.applyInput("hunter", input(i, 0, 1)); // keep hunter away meanwhile
      sim.step();
    }

    // Chase (with boost) a point on the wall snake's trail, re-aimed each tick
    let died = false;
    for (let i = 41; i <= 600 && !died; i++) {
      const hunterHead = must(sim.getHead("hunter"));
      const wallHead = must(sim.getHead("wall"));
      const target = { x: wallHead.x - 60, y: wallHead.y };
      sim.applyInput("hunter", input(i, target.x - hunterHead.x, target.y - hunterHead.y, true));
      sim.applyInput("wall", input(i, 1, 0));
      const result = sim.step();
      if (result.deaths.some((d) => d.id === "hunter")) {
        died = true;
        // Death converts body to food
        expect(result.snapshot.foodSpawned?.length ?? 0).toBeGreaterThan(0);
      }
    }

    expect(died).toBe(true);
    expect(sim.isAlive("hunter")).toBe(false);
    expect(sim.isAlive("wall")).toBe(true);

    // Dead snakes are excluded from snapshots until respawn
    const snap = sim.step().snapshot;
    expect(snap.players.map((p) => p.id)).toEqual(["wall"]);

    expect(sim.respawn("hunter")).toBe(true);
    expect(sim.isAlive("hunter")).toBe(true);
  });

  it("does not die from crossing its own body (self-collision off)", () => {
    const sim = makeSim({ initialFood: 0 });
    sim.addPlayer("p1", null);

    // Drive in a tight circle so the head repeatedly crosses its own trail
    let alive = true;
    for (let i = 1; i <= 300 && alive; i++) {
      const angle = i * 0.35;
      sim.applyInput("p1", input(i, Math.cos(angle), Math.sin(angle)));
      alive = sim.step().deaths.length === 0;
    }

    expect(alive).toBe(true);
    expect(sim.isAlive("p1")).toBe(true);
  });

  it("keeps snakes inside the world bounds", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);

    // Drive hard toward the left wall for a long time
    for (let i = 1; i <= 400; i++) {
      sim.applyInput("p1", input(i, -1, 0));
      sim.step();
    }

    const head = must(sim.getHead("p1"));
    expect(head.x).toBeGreaterThanOrEqual(0);
    expect(head.y).toBeGreaterThanOrEqual(0);
    expect(head.x).toBeLessThanOrEqual(DEFAULT_TUNABLES.worldWidth);
    expect(head.y).toBeLessThanOrEqual(DEFAULT_TUNABLES.worldHeight);
  });

  it("respawns food up to maxFood and reports spawns in snapshots", () => {
    const sim = makeSim({ initialFood: 0, maxFood: 3, foodSpawnIntervalTicks: 2 });
    sim.addPlayer("p1", null);

    const spawned: number[] = [];
    for (let i = 1; i <= 20; i++) {
      sim.applyInput("p1", input(i, 1, 0));
      const result = sim.step();
      spawned.push(result.snapshot.foodSpawned?.length ?? 0);
    }

    expect(spawned.reduce((a, b) => a + b, 0)).toBe(3);
    expect(sim.getBootstrapState().food).toHaveLength(3);
  });

  it("rejoin returns the same meta; leaderboard ranks by length", () => {
    const sim = makeSim();
    const first = sim.addPlayer("p1", "Alice");
    const again = sim.addPlayer("p1", "Alice");
    expect(again.isNew).toBe(false);
    expect(again.meta.hue).toBe(first.meta.hue);

    sim.addPlayer("p2", "Bob");
    const board = sim.leaderboard();
    expect(board).toHaveLength(2);
    expect(must(board[0]).len).toBeGreaterThanOrEqual(must(board[1]).len);
  });
});

describe("NPC snakes", () => {
  function npcSim(count = 3): GameWorldSim {
    return new GameWorldSim({ seed: 11, tunables: { npcCount: count, npcRespawnTicks: 5 } });
  }

  it("syncs the population to npcCount, including live lowering", () => {
    const sim = npcSim(3);
    sim.step();
    expect(sim.playerCount()).toBe(3);
    expect(sim.humanCount()).toBe(0);

    sim.applyTunables({ npcCount: 1 });
    sim.step();
    expect(sim.playerCount()).toBe(1);

    sim.applyTunables({ npcCount: 4 });
    sim.step();
    expect(sim.playerCount()).toBe(4);
  });

  it("excludes NPCs from humanCount but includes them in snapshots", () => {
    const sim = npcSim(2);
    sim.addPlayer("human", "Human");
    const result = sim.step();

    expect(sim.humanCount()).toBe(1);
    expect(sim.playerCount()).toBe(3);
    expect(result.snapshot.players).toHaveLength(3);
    const npcSnaps = result.snapshot.players.filter((p) => p.id.startsWith("npc-"));
    expect(npcSnaps).toHaveLength(2);
  });

  it("NPCs find and eat food", () => {
    const sim = npcSim(1);
    let ate = false;
    for (let i = 0; i < 400 && !ate; i++) {
      const result = sim.step();
      if (result.snapshot.foodEaten?.length) ate = true;
    }
    expect(ate).toBe(true);
    expect(must(sim.getLength("npc-0"))).toBeGreaterThan(DEFAULT_TUNABLES.startLength);
  });

  it("NPCs stay inside the world bounds (wall avoidance)", () => {
    const sim = npcSim(3);
    for (let i = 0; i < 600; i++) {
      sim.step();
    }
    for (const id of ["npc-0", "npc-1", "npc-2"]) {
      if (!sim.isAlive(id)) continue;
      const head = must(sim.getHead(id));
      expect(head.x).toBeGreaterThan(0);
      expect(head.y).toBeGreaterThan(0);
      expect(head.x).toBeLessThan(DEFAULT_TUNABLES.worldWidth);
      expect(head.y).toBeLessThan(DEFAULT_TUNABLES.worldHeight);
    }
  });

  it("dead NPCs respawn after npcRespawnTicks", () => {
    // Cramped world makes an NPC death inevitable, then the cooldown revives it
    const tiny = new GameWorldSim({
      seed: 13,
      tunables: {
        npcCount: 3,
        npcRespawnTicks: 5,
        worldWidth: 450,
        worldHeight: 450,
        initialFood: 5,
      },
    });
    let deathTick = 0;
    for (let i = 0; i < 3000 && deathTick === 0; i++) {
      const result = tiny.step();
      if (result.deaths.some((d) => d.id.startsWith("npc-"))) deathTick = tiny.tick;
    }
    expect(deathTick).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) tiny.step();
    const aliveCount = ["npc-0", "npc-1", "npc-2"].filter((id) => tiny.isAlive(id)).length;
    expect(aliveCount).toBeGreaterThan(0);
  });

  it("NPC behavior is deterministic for a fixed seed", () => {
    const a = npcSim(2);
    const b = npcSim(2);
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(a.getHead("npc-0")).toEqual(b.getHead("npc-0"));
    expect(a.getHead("npc-1")).toEqual(b.getHead("npc-1"));
  });
});
