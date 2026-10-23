import { afterEach, describe, it, expect, vi } from "vitest";
import { GameWorldSim } from "./world.js";
import { GameLoop, type GameLoopEmits } from "./loop.js";

function makeLoop(hasAudience?: () => boolean): {
  sim: GameWorldSim;
  loop: GameLoop;
  events: (keyof GameLoopEmits)[];
} {
  const sim = new GameWorldSim({ seed: 3, tunables: { npcCount: 2 } });
  const events: (keyof GameLoopEmits)[] = [];
  const loop = new GameLoop({
    sim,
    emit: {
      snapshot: () => {
        events.push("snapshot");
      },
      death: () => {
        events.push("death");
      },
      leaderboard: () => {
        events.push("leaderboard");
      },
    },
    hasAudience,
  });
  return { sim, loop, events };
}

describe("GameLoop idle gate", () => {
  it("freezes the sim when nobody plays and nobody watches", () => {
    const { loop, sim, events } = makeLoop(() => false);
    expect(loop.tickOnce()).toBeNull();
    loop.emitLeaderboard();
    expect(sim.tick).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("spectators (audience) keep the NPC world ticking", () => {
    const { loop, sim, events } = makeLoop(() => true);
    expect(loop.tickOnce()).not.toBeNull();
    expect(sim.tick).toBe(1);
    expect(events).toContain("snapshot");
    loop.emitLeaderboard();
    expect(events).toContain("leaderboard");
  });

  it("a playing human keeps the sim ticking even with no audience callback", () => {
    const { loop, sim } = makeLoop();
    sim.addPlayer("u1", "Human");
    expect(loop.tickOnce()).not.toBeNull();
    expect(sim.tick).toBe(1);
  });
});

describe("GameLoop tick grid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aims each tick at a fixed 20 Hz grid, and starts the grid again after a stall", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timers: { fire: () => void; ms: number }[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fire: () => void, ms: number) => {
      timers.push({ fire, ms });
      return { unref: () => undefined };
    }) as unknown as typeof setTimeout);
    const { loop, sim } = makeLoop(() => true);
    const fireAt = (at: number) => {
      now = at;
      timers.shift()?.fire();
    };

    loop.start();
    expect(timers.map((t) => t.ms)).toEqual([50]);
    // 20 ms late: the next tick still lands on the grid (100 ms), not 50 ms on
    fireAt(70);
    expect(timers[0]?.ms).toBe(30);
    fireAt(100);
    expect(timers[0]?.ms).toBe(50);
    // more than a tick behind (due at 150): one tick now, then the grid runs from here
    fireAt(270);
    expect(timers[0]?.ms).toBe(0);
    fireAt(270);
    expect(timers[0]?.ms).toBe(50);
    expect(sim.tick).toBe(4);

    loop.stop();
  });
});
