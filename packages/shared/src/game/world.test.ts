import { describe, it, expect } from "vitest";
import type { GameInput } from "../types/game.js";
import { stepMovement } from "./movement.js";
import { COUNT_TUNABLE_MAX, GameWorldSim, DEFAULT_TUNABLES, type SnakeState } from "./world.js";

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

/** No food: the collision tests count deaths only. */
const NO_FOOD = { initialFood: 0, foodSpawnIntervalTicks: 100000 };

/** The sim's own snakes, whose geometry the collision tests set by hand. */
function snakesOf(sim: GameWorldSim): Map<string, SnakeState> {
  return (sim as unknown as { players: Map<string, SnakeState> }).players;
}

/**
 * Puts a snake's head at (x, y), heading along (dirX, dirY), its body laid
 * straight behind it, a path sample every 9 px (a step at base speed). Its
 * client has sent no frame, so it holds still: a tick judges this geometry.
 */
function lay(
  sim: GameWorldSim,
  id: string,
  head: { x: number; y: number; dirX: number; dirY: number },
): void {
  const snake = must(snakesOf(sim).get(id));
  snake.head = { x: head.x, y: head.y };
  snake.dir = { x: head.dirX, y: head.dirY };
  snake.path = Array.from({ length: 12 }, (_, i) => ({
    x: head.x - head.dirX * 9 * (11 - i),
    y: head.y - head.dirY * 9 * (11 - i),
  }));
}

describe("GameWorldSim", () => {
  it("is deterministic: same seed + same inputs → identical state", () => {
    const a = makeSim();
    const b = makeSim();
    a.addPlayer("p1", "Player");
    b.addPlayer("p1", "Player");

    for (let i = 1; i <= 50; i++) {
      a.queueInputs("p1", [input(i, 1, 0.5)]);
      b.queueInputs("p1", [input(i, 1, 0.5)]);
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
    sim.queueInputs("p1", [input(1, snap.dx, snap.dy)]);
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
    sim.queueInputs("p1", [input(1, -first.dx, -first.dy)]);
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
      sim.queueInputs("p1", [input(i, 1, 0, true)]);
      sim.step();
    }

    const len = must(sim.getLength("p1"));
    expect(len).toBeLessThan(startLen);
    expect(len).toBeGreaterThanOrEqual(DEFAULT_TUNABLES.minLength);
  });

  it("sends the length with its fraction: a replay from the snapshot boosts as the server does", () => {
    // one boosted tick burns 0.075: 10.475 → 10.4, within a segment of minLength
    const sim = makeSim({ minLength: 10, startLength: 10.475 });
    sim.addPlayer("p1", null);
    const first = must(sim.step().snapshot.players[0]);
    sim.queueInputs("p1", [input(1, first.dx, first.dy, true)]);
    const start = must(sim.getHead("p1"));
    const snap = must(sim.step().snapshot.players[0]);
    const head = must(sim.getHead("p1"));
    expect(snap.len).toBe(Math.fround(10.4));
    expect(snap.boost).toBe(true);
    expect(Math.hypot(head.x - start.x, head.y - start.y)).toBeCloseTo(
      DEFAULT_TUNABLES.boostSpeed * sim.dt,
      5,
    );

    // the client replays its next frame from the snapshot: a boosted step, as the server's
    const next = input(2, snap.dx, snap.dy, true);
    const replayed = stepMovement(
      { x: snap.x, y: snap.y, dirX: snap.dx, dirY: snap.dy, len: snap.len },
      { targetDx: next.dx, targetDy: next.dy, boost: next.boost },
      { ...DEFAULT_TUNABLES, minLength: 10 },
      sim.dt,
    );
    sim.queueInputs("p1", [next]);
    const after = must(sim.step().snapshot.players[0]);
    expect(Math.hypot(replayed.x - after.x, replayed.y - after.y)).toBeLessThan(0.2);
    expect(replayed.len).toBeCloseTo(after.len, 1);
  });

  it("sends a length on the sim's side of the minimum, which float32 rounding alone could flip", () => {
    // float32 holds no 5.3: Math.fround(5.3) is above it, which would say a snake at the minimum boosts
    const atMin = makeSim({ minLength: 5.3, startLength: 5.3 });
    atMin.addPlayer("p1", null);
    expect(must(atMin.step().snapshot.players[0]).len).toBeLessThanOrEqual(5.3);
    // a float error just above the minimum: the server boosts once more, and so must the replay
    const above = makeSim({ minLength: 5, startLength: 5 + 1e-12 });
    above.addPlayer("p1", null);
    const snap = must(above.step().snapshot.players[0]);
    expect(snap.len).toBeGreaterThan(5);
    expect(snap.len).toBe(Math.fround(snap.len));
  });

  it("acknowledges the last frame its state holds, and ignores a frame at or below it", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);

    sim.queueInputs("p1", [input(5, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).ack).toBe(5);
    const head = must(sim.getHead("p1"));

    // A regression arrives late: never stepped; the tick has no frame, so the
    // snake coasts one step on its last intent, standing in for frame 6
    sim.queueInputs("p1", [input(3, 0, 1)]);
    const result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(6);
    expect(result.inputs).toEqual({ p1: { stepped: 0, depth: 0 } });
    const coasted = must(sim.getHead("p1"));
    expect(Math.hypot(coasted.x - head.x, coasted.y - head.y)).toBeCloseTo(
      DEFAULT_TUNABLES.baseSpeed * sim.dt,
      5,
    );
  });

  it("steps a backlog two a tick, holding the frame that arrived early for its own tick", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    const start = must(sim.getHead("p1"));

    // Three frames in one message, along the snake's own heading
    const snap = must(sim.getBootstrapState().snaps[0]);
    sim.queueInputs(
      "p1",
      [1, 2, 3].map((seq) => input(seq, snap.dx, snap.dy)),
    );
    let result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(2);
    expect(result.inputs).toEqual({ p1: { stepped: 2, depth: 1 } });
    result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(3);
    expect(result.inputs).toEqual({ p1: { stepped: 1, depth: 0 } });

    const after = must(sim.getHead("p1"));
    expect(Math.hypot(after.x - start.x, after.y - start.y)).toBeCloseTo(
      3 * DEFAULT_TUNABLES.baseSpeed * sim.dt,
      1,
    );
  });

  it("a tick without a frame coasts, standing in for the late frame, which is ignored when it arrives", () => {
    const steer = (seq: number): GameInput => input(seq, Math.cos(seq / 5), Math.sin(seq / 5));

    // Lossless: one message per tick
    const lossless = makeSim();
    lossless.addPlayer("p1", null);
    for (let seq = 1; seq <= 12; seq++) {
      lossless.queueInputs("p1", [steer(seq)]);
      lossless.step();
    }

    // Lossy: the messages of frames 5 to 7 are lost; each message carries
    // the three frames before its newest, as the client's pending tail does
    const lossy = makeSim();
    lossy.addPlayer("p1", null);
    const stepped: number[] = [];
    const acks: number[] = [];
    let last = must(lossy.getHead("p1"));
    for (let seq = 1; seq <= 12; seq++) {
      if (seq < 5 || seq > 7) {
        const from = Math.max(1, seq - 3);
        lossy.queueInputs(
          "p1",
          Array.from({ length: seq - from + 1 }, (_, i) => steer(from + i)),
        );
      }
      const result = lossy.step();
      stepped.push(result.inputs.p1?.stepped ?? -1);
      acks.push(must(result.snapshot.players[0]).ack);
      // one step every tick: the snake never holds still
      const head = must(lossy.getHead("p1"));
      expect(Math.hypot(head.x - last.x, head.y - last.y)).toBeCloseTo(
        DEFAULT_TUNABLES.baseSpeed * lossy.dt,
        5,
      );
      last = head;
    }

    // Ticks 5 to 7 coasted on frame 4's intent, each standing in for its
    // frame; frame 8's message brought 5 to 8, and 5 to 7 were ignored
    expect(stepped).toEqual([1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1]);
    expect(acks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // The end differs from the lossless end only by the intents of 5 to 7
    const end = must(lossy.getHead("p1"));
    const want = must(lossless.getHead("p1"));
    expect(Math.hypot(end.x - want.x, end.y - want.y)).toBeLessThan(
      3 * DEFAULT_TUNABLES.baseSpeed * lossy.dt,
    );
    expect(lossy.getLength("p1")).toEqual(lossless.getLength("p1"));
  });

  it("a late frame steers the next tick instead of stepping: the ack counts the steps", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    const heading = (): number => {
      const snap = must(sim.getBootstrapState().snaps[0]);
      return Math.atan2(snap.dy, snap.dx);
    };
    const turn = (from: number, to: number): number =>
      Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const start = heading();
    const stepPx = DEFAULT_TUNABLES.baseSpeed * sim.dt;
    const maxTurn = DEFAULT_TUNABLES.turnRate * sim.dt;

    // frame 1 along the heading steps; tick 2 has no frame: the snake coasts,
    // standing in for frame 2
    sim.queueInputs("p1", [input(1, Math.cos(start), Math.sin(start))]);
    sim.step();
    let result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(2);
    expect(result.inputs).toEqual({ p1: { stepped: 0, depth: 0 } });
    expect(heading()).toBeCloseTo(start, 6);

    // frame 2 arrives late and alone, aiming a quarter turn to the left: it is
    // not stepped (the ack moves on by the coast, one step), but the coast
    // turns toward it
    let head = must(sim.getHead("p1"));
    sim.queueInputs("p1", [input(2, Math.cos(start + Math.PI / 2), Math.sin(start + Math.PI / 2))]);
    result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(3);
    expect(result.inputs).toEqual({ p1: { stepped: 0, depth: 0 } });
    expect(turn(start, heading())).toBeCloseTo(maxTurn, 2);
    let moved = must(sim.getHead("p1"));
    expect(Math.hypot(moved.x - head.x, moved.y - head.y)).toBeCloseTo(stepPx, 5);

    // an older frame does not steer: frame 1 again, aiming back, leaves the
    // turn toward frame 2's aim
    head = moved;
    sim.queueInputs("p1", [input(1, -Math.cos(start), -Math.sin(start))]);
    result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(4);
    expect(turn(start, heading())).toBeCloseTo(2 * maxTurn, 2);
    moved = must(sim.getHead("p1"));
    expect(Math.hypot(moved.x - head.x, moved.y - head.y)).toBeCloseTo(stepPx, 5);

    // frame 5, in before its tick, steps as usual and the ack follows it
    sim.queueInputs("p1", [input(5, Math.cos(start), Math.sin(start))]);
    result = sim.step();
    expect(must(result.snapshot.players[0]).ack).toBe(5);
    expect(result.inputs).toEqual({ p1: { stepped: 1, depth: 0 } });
  });

  it("says late when the client numbered past the frame a coast stood in for, and for the late frame itself by its own rule", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    sim.queueInputs("p1", [input(1, 1, 0)]);
    sim.step();
    // tick 2 coasts for frame 2; the snapshot reached the client before it
    // stepped frame 2 (a round trip under a tick), so it numbers the next 3
    expect(must(sim.step().snapshot.players[0]).ack).toBe(2);
    sim.queueInputs("p1", [input(1, 1, 0), input(3, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBe(true);
    // in time again: frame 4 before its tick
    sim.queueInputs("p1", [input(3, 1, 0), input(4, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();
    // a coast whose frame comes in time for the next tick, in a message with
    // the one after it: the late frame's own rule, not a skip
    expect(must(sim.step().snapshot.players[0]).ack).toBe(5);
    sim.queueInputs("p1", [input(5, 1, 0), input(6, 1, 0)]);
    const snap = must(sim.step().snapshot.players[0]);
    expect(snap.ack).toBe(6);
    expect(snap.late).toBe(true);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();
  });

  it("says late on the tick's snapshot after a late frame steered, once, and never for a redundant frame", () => {
    const sim = makeSim();
    sim.addPlayer("p1", null);
    sim.queueInputs("p1", [input(1, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();
    // tick 2 coasts, standing in for frame 2
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();

    // frame 2 lands after the coast: its intent is adopted, and the next
    // tick's snapshot says so; a keyframe between ticks leaves it to the tick's
    sim.queueInputs("p1", [input(1, 1, 0), input(2, 0, 1)]);
    expect(must(sim.keyframe().players[0]).late).toBeUndefined();
    expect(must(sim.getBootstrapState().snaps[0]).late).toBeUndefined();
    expect(must(sim.step().snapshot.players[0]).late).toBe(true);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();

    // the coasts stood in for frames 3 and 4, and the client numbered past
    // them (late once more); frames in time from then on, each message
    // repeating the ones before it, are never late
    sim.queueInputs("p1", [input(5, 1, 0), input(6, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBe(true);
    sim.queueInputs("p1", [input(5, 1, 0), input(6, 1, 0), input(7, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();
    sim.queueInputs("p1", [input(6, 1, 0), input(7, 1, 0), input(8, 1, 0)]);
    expect(must(sim.step().snapshot.players[0]).late).toBeUndefined();
    expect(must(sim.step().snapshot.players[0]).ack).toBe(8);
  });

  it("accounts for human snakes that stepped since they spawned, never NPCs", () => {
    const sim = makeSim({ npcCount: 2 });
    sim.addPlayer("p1", null);
    sim.addPlayer("p2", null);
    const p2 = must(sim.getHead("p2"));

    // Neither client has sent a frame yet: no tick before the first coasts
    expect(sim.step().inputs).toEqual({});
    expect(sim.getHead("p2")).toEqual(p2);

    sim.queueInputs("p1", [input(1, 1, 0)]);
    expect(sim.step().inputs).toEqual({ p1: { stepped: 1, depth: 0 } });
    // p1 has stepped: a tick without a frame coasts
    const result = sim.step();
    expect(result.inputs).toEqual({ p1: { stepped: 0, depth: 0 } });
    expect(result.snapshot.players.some((p) => p.id.startsWith("npc-"))).toBe(true);
    // p2 never sent one: it waits where it spawned
    expect(sim.getHead("p2")).toEqual(p2);
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
      sim.queueInputs("p1", [input(i, Math.cos(angle), Math.sin(angle))]);
      const result = sim.step();
      if (result.food?.eaten?.length) ate = true;
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
      sim.queueInputs("wall", [input(i, 1, 0)]);
      sim.queueInputs("hunter", [input(i, 0, 1)]); // keep hunter away meanwhile
      sim.step();
    }

    // Chase (with boost) a point on the wall snake's trail, re-aimed each tick
    let died = false;
    for (let i = 41; i <= 600 && !died; i++) {
      const hunterHead = must(sim.getHead("hunter"));
      const wallHead = must(sim.getHead("wall"));
      const target = { x: wallHead.x - 60, y: wallHead.y };
      sim.queueInputs("hunter", [input(i, target.x - hunterHead.x, target.y - hunterHead.y, true)]);
      sim.queueInputs("wall", [input(i, 1, 0)]);
      const result = sim.step();
      const death = result.deaths.find((d) => d.id === "hunter");
      if (death) {
        died = true;
        // the death names the snake whose body it ran into
        expect(death.by).toEqual({ id: "wall", name: null });
        expect(death.contact).toBe("body");
        // Death converts body to food
        expect(result.food?.spawned?.length ?? 0).toBeGreaterThan(0);
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

  it("checks every head a tick of several steps passed: a burst cannot step over a body", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("wall", "Wall");
    sim.addPlayer("runner", null);
    // Lay the wall's body along y = 500 and put the runner 25 px below it,
    // facing it (the geometry is set on the sim's own snakes)
    const players = snakesOf(sim);
    const wall = must(players.get("wall"));
    wall.path = Array.from({ length: 30 }, (_, i) => ({
      x: 300 + i * 8,
      y: 500,
    }));
    wall.head = { x: 532, y: 500 };
    wall.dir = { x: 1, y: 0 };
    const runner = must(players.get("runner"));
    runner.head = { x: 420, y: 525 };
    runner.dir = { x: 0, y: -1 };
    runner.path = [{ ...runner.head }];

    sim.queueInputs("wall", [input(1, 1, 0)]);
    // Four boosted frames at once: a backlog, so three step this tick (48 px)
    // and the head ends 23 px past the body, out of reach of the final check
    sim.queueInputs(
      "runner",
      [1, 2, 3, 4].map((seq) => input(seq, 0, -1, true)),
    );
    const result = sim.step();
    expect(result.inputs.runner?.stepped).toBe(3);
    expect(result.deaths).toEqual([
      { id: "runner", len: 9, by: { id: "wall", name: "Wall" }, contact: "body" },
    ]);
  });

  it("judges each head a burst passed with the heading it had there, not the tick's last", () => {
    // A runner heading +x steps three frames this tick, each turning it
    // toward +y (0.2 rad a step); a post (one sample, its own head) sits
    // 15 px from the first head it passes, in front of the heading it had
    // there or behind it, and out of reach of the heads after it
    const burst = (angle: number): { runner: boolean; deaths: unknown[] } => {
      const sim = makeSim(NO_FOOD);
      sim.addPlayer("runner", "Runner");
      sim.addPlayer("post", "Post");
      const players = snakesOf(sim);
      const runner = must(players.get("runner"));
      runner.head = { x: 500, y: 500 };
      runner.dir = { x: 1, y: 0 };
      runner.path = [{ x: 500, y: 500 }];
      const first = stepMovement(
        { x: 500, y: 500, dirX: 1, dirY: 0, len: runner.len },
        { targetDx: 0, targetDy: 1, boost: false },
        DEFAULT_TUNABLES,
        sim.dt,
      );
      const post = must(players.get("post"));
      post.head = { x: first.x + 15 * Math.cos(angle), y: first.y + 15 * Math.sin(angle) };
      // facing away from the runner, which it never kills
      post.dir = { x: 0, y: Math.sin(angle) > 0 ? 1 : -1 };
      post.path = [{ ...post.head }];
      sim.queueInputs(
        "runner",
        [1, 2, 3, 4].map((seq) => input(seq, 0, 1)),
      );
      const result = sim.step();
      expect(result.inputs.runner?.stepped).toBe(3);
      return { runner: sim.isAlive("runner"), deaths: result.deaths };
    };

    // 1.37 rad to the left of the first head's heading (0.2 rad): inside its
    // front arc, though behind the tick's last heading (0.6 rad)
    expect(burst(0.2 - 1.37)).toEqual({
      runner: false,
      deaths: [{ id: "runner", len: 10, by: { id: "post", name: "Post" }, contact: "head" }],
    });
    // 1.77 rad to its right: behind it, though inside the last heading's arc
    expect(burst(0.2 + 1.77)).toEqual({ runner: true, deaths: [] });
  });

  it("a rear-end kills the chaser: its head met the back of the other's head", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("lead", "Lead");
    sim.addPlayer("chaser", "Chaser");
    lay(sim, "lead", { x: 500, y: 500, dirX: 1, dirY: 0 });
    // from behind the lead, up and to the right: the lead's head lies in
    // front of the chaser's, the chaser's behind the lead's centre
    lay(sim, "chaser", { x: 496, y: 512, dirX: 0.6, dirY: -0.8 });

    expect(sim.step().deaths).toEqual([
      { id: "chaser", len: 10, by: { id: "lead", name: "Lead" }, contact: "head" },
    ]);
    expect(sim.isAlive("lead")).toBe(true);
  });

  it("a side hit behind the other's centre kills only the snake that made it", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("victim", "Victim");
    sim.addPlayer("attacker", "Attacker");
    lay(sim, "victim", { x: 500, y: 500, dirX: 1, dirY: 0 });
    // straight up into the victim's head, 3 px behind its centre
    lay(sim, "attacker", { x: 497, y: 513, dirX: 0, dirY: -1 });

    expect(sim.step().deaths).toEqual([
      { id: "attacker", len: 10, by: { id: "victim", name: "Victim" }, contact: "head" },
    ]);
    expect(sim.isAlive("victim")).toBe(true);
  });

  it("with a 360-degree kill arc, the same side hit kills both, as a whole-head rule does", () => {
    const sim = makeSim({ ...NO_FOOD, killArcDeg: 360 });
    sim.addPlayer("victim", "Victim");
    sim.addPlayer("attacker", "Attacker");
    lay(sim, "victim", { x: 500, y: 500, dirX: 1, dirY: 0 });
    lay(sim, "attacker", { x: 497, y: 513, dirX: 0, dirY: -1 });

    expect(sim.step().deaths).toEqual([
      { id: "victim", len: 10, by: { id: "attacker", name: "Attacker" }, contact: "head" },
      { id: "attacker", len: 10, by: { id: "victim", name: "Victim" }, contact: "head" },
    ]);
  });

  it("a head-on kills both, each by the other", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("east", "East");
    sim.addPlayer("west", "West");
    lay(sim, "east", { x: 491, y: 500, dirX: 1, dirY: 0 });
    lay(sim, "west", { x: 509, y: 500, dirX: -1, dirY: 0 });

    expect(sim.step().deaths).toEqual([
      { id: "east", len: 10, by: { id: "west", name: "West" }, contact: "head" },
      { id: "west", len: 10, by: { id: "east", name: "East" }, contact: "head" },
    ]);
  });

  it("a T-bone into a body kills the rammer, by the body", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("wall", "Wall");
    sim.addPlayer("rammer", "Rammer");
    // the wall's body along y = 500, from x 481 to its head at 580
    lay(sim, "wall", { x: 580, y: 500, dirX: 1, dirY: 0 });
    lay(sim, "rammer", { x: 500, y: 514, dirX: 0, dirY: -1 });

    expect(sim.step().deaths).toEqual([
      { id: "rammer", len: 10, by: { id: "wall", name: "Wall" }, contact: "body" },
    ]);
    expect(sim.isAlive("wall")).toBe(true);
  });

  it("a cut-off kills the snake cut off: its head met the cutter's neck, behind the cutter's head", () => {
    const sim = makeSim(NO_FOOD);
    sim.addPlayer("cutter", "Cutter");
    sim.addPlayer("cut", "Cut");
    // the cutter crossed in front of the other: its head 12 px past it,
    // within reach of its head, behind the cutter's centre
    lay(sim, "cutter", { x: 512, y: 500, dirX: 1, dirY: 0 });
    lay(sim, "cut", { x: 500, y: 510, dirX: 0, dirY: -1 });

    expect(sim.step().deaths).toEqual([
      { id: "cut", len: 10, by: { id: "cutter", name: "Cutter" }, contact: "body" },
    ]);
    expect(sim.isAlive("cutter")).toBe(true);
  });

  it("does not die from crossing its own body (self-collision off)", () => {
    const sim = makeSim({ initialFood: 0 });
    sim.addPlayer("p1", null);

    // Drive in a tight circle so the head repeatedly crosses its own trail
    let alive = true;
    for (let i = 1; i <= 300 && alive; i++) {
      const angle = i * 0.35;
      sim.queueInputs("p1", [input(i, Math.cos(angle), Math.sin(angle))]);
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
      sim.queueInputs("p1", [input(i, -1, 0)]);
      sim.step();
    }

    const head = must(sim.getHead("p1"));
    expect(head.x).toBeGreaterThanOrEqual(0);
    expect(head.y).toBeGreaterThanOrEqual(0);
    expect(head.x).toBeLessThanOrEqual(DEFAULT_TUNABLES.worldWidth);
    expect(head.y).toBeLessThanOrEqual(DEFAULT_TUNABLES.worldHeight);
  });

  it("respawns food up to maxFood and reports spawns as the tick's food change", () => {
    const sim = makeSim({
      initialFood: 0,
      maxFood: 3,
      foodSpawnIntervalTicks: 2,
    });
    sim.addPlayer("p1", null);

    const spawned: number[] = [];
    for (let i = 1; i <= 20; i++) {
      sim.queueInputs("p1", [input(i, 1, 0)]);
      const result = sim.step();
      spawned.push(result.food?.spawned?.length ?? 0);
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

describe("tunables", () => {
  it("keeps the counts of food and NPCs within a packed snapshot's 16 bits", () => {
    const sim = new GameWorldSim({ seed: 1, tunables: { initialFood: 0 } });
    sim.applyTunables({
      maxFood: 1e9,
      initialFood: 70_000,
      npcCount: 1e6,
      worldWidth: 1e5,
    });
    expect(sim.tunables.maxFood).toBe(COUNT_TUNABLE_MAX);
    expect(sim.tunables.initialFood).toBe(COUNT_TUNABLE_MAX);
    expect(sim.tunables.npcCount).toBe(COUNT_TUNABLE_MAX);
    // positions travel in 32 bits: the world's size is the admin's
    expect(sim.tunables.worldWidth).toBe(1e5);
  });

  it("keeps the kill arc within the whole head", () => {
    const sim = new GameWorldSim({ seed: 1, tunables: { initialFood: 0 } });
    expect(sim.tunables.killArcDeg).toBe(180);
    sim.applyTunables({ killArcDeg: 720 });
    expect(sim.tunables.killArcDeg).toBe(360);
    sim.applyTunables({ killArcDeg: -90 });
    expect(sim.tunables.killArcDeg).toBe(360);
  });
});

describe("NPC snakes", () => {
  function npcSim(count = 3): GameWorldSim {
    return new GameWorldSim({
      seed: 11,
      tunables: { npcCount: count, npcRespawnTicks: 5 },
    });
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
      if (result.food?.eaten?.length) ate = true;
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
