import { describe, it, expect } from "vitest";
import { GAME_EVENTS } from "@project/shared";
import { GameWorldSim } from "./world.js";
import { GameLoop } from "./loop.js";

function makeLoop(hasAudience?: () => boolean): {
  sim: GameWorldSim;
  loop: GameLoop;
  events: string[];
} {
  const sim = new GameWorldSim({ seed: 3, tunables: { npcCount: 2 } });
  const events: string[] = [];
  const loop = new GameLoop({
    sim,
    emitVolatile: (event) => {
      events.push(event);
    },
    emitReliable: (event) => {
      events.push(event);
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
    loop.emitLeaderboard();
    expect(events).toContain(GAME_EVENTS.leaderboard);
  });

  it("a playing human keeps the sim ticking even with no audience callback", () => {
    const { loop, sim } = makeLoop();
    sim.addPlayer("u1", "Human");
    expect(loop.tickOnce()).not.toBeNull();
    expect(sim.tick).toBe(1);
  });
});
