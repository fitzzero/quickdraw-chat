/**
 * GameClientCore's routing of the wire's word, on a hand-built snapshot
 * sequence over a fake transport: its own snake reconciles, the others
 * interpolate, an older snapshot is ignored, a death drops the local snake
 * until the next own snapshot respawns it, and a food gap asks for one
 * keyframe.
 */

import { describe, expect, it } from "vitest";
import type { GameDeathEvent, GameInput, PlayerSnap, WorldSnapshot } from "../../types/game.js";
import { GAME_TICK_RATE } from "../../types/game.js";
import { DEFAULT_TUNABLES } from "../world.js";
import { GameClientCore, type GameClientHooks } from "./core.js";
import type { GameJoin, GameTransport, GameWire } from "./transport.js";

const ME = "p1";
const OTHER = "p2";
const TICK_MS = 1000 / GAME_TICK_RATE;

/** A player's snap: at `x` heading right, `ack` frames stepped. */
function snapOf(id: string, x: number, ack = 0, extra: Partial<PlayerSnap> = {}): PlayerSnap {
  return { id, x, y: 500, dx: 1, dy: 0, len: 10, boost: false, ack, ...extra };
}

/** A tick's snapshot, stamped as the server stamps it. */
function snapshot(
  tick: number,
  players: PlayerSnap[],
  food?: WorldSnapshot["food"],
): WorldSnapshot {
  return { tick, t: tick * TICK_MS, players, ...(food ? { food } : {}) };
}

/** The wire in hand: what the core sent, asked and heard. */
class FakeTransport implements GameTransport {
  public wire: GameWire | null = null;
  public readonly sent: GameInput[][] = [];
  public keyframeAsks = 0;
  public respawns = 0;
  public closed = false;
  public needsKeyframe = false;
  /** Keyframe asks never answered (the ask stays in flight) when false. */
  public answerKeyframes = true;

  constructor(private readonly join: GameJoin) {}

  public start(wire: GameWire): Promise<GameJoin> {
    this.wire = wire;
    wire.follow("server-a");
    return Promise.resolve(this.join);
  }

  public sendInput(frames: GameInput[]): void {
    this.sent.push(frames);
  }

  public requestKeyframe(): Promise<void> {
    this.keyframeAsks += 1;
    return this.answerKeyframes ? Promise.resolve() : new Promise(() => {});
  }

  public respawn(): void {
    this.respawns += 1;
  }

  public close(): void {
    this.closed = true;
  }
}

/** A core over the fake wire, its clock in hand, and what its hooks heard. */
async function client(
  join: GameJoin,
  spectator = false,
): Promise<{
  core: GameClientCore;
  transport: FakeTransport;
  wire: GameWire;
  heard: {
    arrivals: number[];
    acks: number[];
    corrections: number[];
    spawns: PlayerSnap[];
    deaths: string[];
    left: string[];
    inputs: number[];
  };
  tick: (seconds: number) => void;
}> {
  let nowMs = 100_000;
  const heard = {
    arrivals: [] as number[],
    acks: [] as number[],
    corrections: [] as number[],
    spawns: [] as PlayerSnap[],
    deaths: [] as string[],
    left: [] as string[],
    inputs: [] as number[],
  };
  const hooks: GameClientHooks = {
    onSnapshotArrival: (_tWall, tick) => heard.arrivals.push(tick),
    onCorrection: (correction, ack) => {
      heard.acks.push(ack);
      heard.corrections.push(correction.magnitudePx);
    },
    onSpawn: (snap) => heard.spawns.push(snap),
    onDeath: (death) => heard.deaths.push(death.id),
    onLeft: (id) => heard.left.push(id),
    onInputSent: (frames) => heard.inputs.push(frames.at(-1)?.seq ?? -1),
  };
  const transport = new FakeTransport(join);
  const core = new GameClientCore({
    transport,
    userId: ME,
    tunables: DEFAULT_TUNABLES,
    tickRate: GAME_TICK_RATE,
    now: (): number => nowMs,
    hooks,
  });
  await core.start(spectator);
  if (!transport.wire) throw new Error("the transport was not started");
  return {
    core,
    transport,
    wire: transport.wire,
    heard,
    tick: (seconds) => {
      nowMs += seconds * 1000;
    },
  };
}

const JOINED: GameJoin = { bounds: { w: 2000, h: 2000 }, own: snapOf(ME, 500) };
const aim = (): { dx: number; dy: number; boost: boolean } => ({ dx: 1, dy: 0, boost: false });

describe("GameClientCore", () => {
  it("spawns the local snake with the join and sends one message per step", async () => {
    const { core, transport, heard, tick } = await client(JOINED);
    expect(core.isAlive).toBe(true);
    expect(heard.spawns).toEqual([JOINED.own]);
    expect(core.localPredictor?.simPos).toEqual({ x: 500, y: 500 });

    tick(1 / GAME_TICK_RATE);
    const rendered = core.renderFrame(1 / GAME_TICK_RATE, aim);
    expect(transport.sent).toHaveLength(1);
    expect(heard.inputs).toEqual([1]);
    // the step moved the sim; the render interpolates from the previous step's position
    expect(core.localPredictor?.simPos.x).toBeGreaterThan(500);
    expect(rendered.local).toMatchObject({ x: 500, y: 500, dx: 1, dy: 0, boost: false });
    expect(rendered.local?.len).toBeCloseTo(10, 5);
    expect(rendered.remotes.size).toBe(0);
    expect(rendered.food).toEqual([]);
  });

  it("reconciles its own snake and interpolates the others", async () => {
    const { core, wire, heard, tick } = await client(JOINED);
    wire.snapshot(snapshot(1, [snapOf(ME, 509, 1), snapOf(OTHER, 100, 0, { boost: true })]));
    expect(heard.acks).toEqual([1]);
    // nothing of ours was pending: the server's step is adopted whole, a 9 px correction
    expect(heard.corrections[0]).toBeCloseTo(9, 5);
    expect(core.localPredictor?.simPos.x).toBeCloseTo(509, 5);
    expect(core.latestTick).toBe(1);

    tick(0.016);
    const rendered = core.renderFrame(0.016, aim);
    expect(rendered.renderTick).not.toBeNull();
    expect(rendered.remotes.has(OTHER)).toBe(true);
    expect(rendered.remotes.has(ME)).toBe(false);
    expect(rendered.remotes.get(OTHER)).toMatchObject({
      y: 500,
      dx: 1,
      dy: 0,
      len: 10,
      boost: true,
    });
  });

  it("ignores a snapshot older than the newest, though a shell still hears it arrive", async () => {
    const { core, wire, heard } = await client(JOINED);
    wire.snapshot(snapshot(5, [snapOf(ME, 500, 5)]));
    wire.snapshot(snapshot(3, [snapOf(ME, 400, 3)]));
    expect(heard.arrivals).toEqual([5, 3]);
    expect(heard.acks).toEqual([5]);
    expect(core.latestTick).toBe(5);
  });

  it("drops the local snake on its death until the next own snapshot respawns it", async () => {
    const { core, wire, heard, tick } = await client(JOINED);
    const death: GameDeathEvent = { id: ME, len: 10 };
    wire.death(death);
    expect(core.isAlive).toBe(false);
    expect(heard.deaths).toEqual([ME]);
    tick(0.016);
    expect(core.renderFrame(0.016, aim).local).toBeNull();

    const respawned = snapOf(ME, 50, 0, { y: 60 });
    wire.snapshot(snapshot(10, [respawned]));
    expect(core.isAlive).toBe(true);
    expect(heard.spawns.at(-1)).toEqual(respawned);
    // the respawn places the snake, it reconciles nothing
    expect(heard.acks).toEqual([]);
    tick(0.001);
    const { local } = core.renderFrame(0.001, aim);
    expect(local?.x).toBeCloseTo(50, 0);
    expect(local?.y).toBeCloseTo(60, 0);
  });

  it("forgets a remote that died or left", async () => {
    const { core, wire, heard, tick } = await client(JOINED);
    wire.snapshot(snapshot(1, [snapOf(ME, 500, 1), snapOf(OTHER, 100), snapOf("p3", 200)]));
    tick(0.016);
    expect(core.renderFrame(0.016, aim).remotes.size).toBe(2);
    wire.death({ id: OTHER, len: 7 });
    wire.left("p3");
    tick(0.016);
    const rendered = core.renderFrame(0.016, aim);
    expect(rendered.remotes.size).toBe(0);
    expect(core.isAlive).toBe(true);
    expect(heard.deaths).toEqual([OTHER]);
    expect(heard.left).toEqual(["p3"]);
  });

  it("asks for one keyframe when it missed more than the food window", async () => {
    const { core, wire, transport } = await client(JOINED);
    transport.answerKeyframes = false;
    wire.keyframe(snapshot(1, [], [{ tick: 1, spawned: [{ id: "f1", x: 0, y: 0, v: 1 }] }]));
    wire.snapshot(snapshot(2, [snapOf(ME, 500, 2)]));
    expect(transport.keyframeAsks).toBe(0);
    // seven ticks past the food held: changes were lost
    wire.snapshot(snapshot(9, [snapOf(ME, 500, 9)]));
    expect(transport.keyframeAsks).toBe(1);
    // the ask is in flight: the next snapshot past the window asks nothing more
    wire.snapshot(snapshot(10, [snapOf(ME, 500, 10)]));
    expect(transport.keyframeAsks).toBe(1);
    expect(core.food.ids()).toEqual(["f1"]);
  });

  it("starts the newest tick over for another server's world", async () => {
    const { core, wire } = await client(JOINED);
    wire.snapshot(snapshot(50, [snapOf(ME, 500, 50)]));
    wire.follow("server-b");
    expect(core.latestTick).toBe(0);
    wire.snapshot(snapshot(1, [snapOf(ME, 500, 1)]));
    expect(core.latestTick).toBe(1);
  });

  it("spectates without a local snake until told to play", async () => {
    const { core, wire, transport, heard, tick } = await client(
      { bounds: { w: 2000, h: 2000 } },
      true,
    );
    expect(core.isAlive).toBe(false);
    expect(core.localPredictor).toBeNull();
    wire.snapshot(snapshot(1, [snapOf(ME, 500, 1), snapOf(OTHER, 100)]));
    tick(0.016);
    expect(core.renderFrame(0.016, aim).local).toBeNull();
    expect(heard.acks).toEqual([]);

    // the page joined the game: the next own snapshot spawns the snake (main.gd)
    core.spawnLocal(null);
    expect(core.isAlive).toBe(false);
    expect(core.localPredictor).not.toBeNull();
    expect(heard.spawns).toEqual([]);
    tick(1 / GAME_TICK_RATE);
    expect(core.renderFrame(1 / GAME_TICK_RATE, aim).local).toBeNull();
    expect(transport.sent).toHaveLength(0);

    const placed = snapOf(ME, 300, 0, { y: 400 });
    wire.snapshot(snapshot(2, [placed, snapOf(OTHER, 100)]));
    expect(core.isAlive).toBe(true);
    expect(heard.spawns).toEqual([placed]);
    expect(heard.acks).toEqual([]);
    tick(0.001);
    const { local } = core.renderFrame(0.001, aim);
    expect(local?.x).toBeCloseTo(300, 0);
    expect(local?.y).toBeCloseTo(400, 0);

    core.dropLocal();
    expect(core.isAlive).toBe(false);
    core.stop();
  });
});
