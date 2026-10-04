import { describe, it, expect } from "vitest";
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
