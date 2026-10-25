/**
 * The bots' prediction against the shared sim: a client that replays from
 * the snapshot decides each step as the server does, so a server step it
 * predicted costs no correction.
 */

import { DEFAULT_TUNABLES, GameWorldSim } from "@project/shared";
import { describe, expect, it } from "vitest";
import { LocalPredictor } from "./prediction.js";

describe("LocalPredictor", () => {
  it("predicts the last boosted step before the minimum length (the snapshot's own length)", () => {
    // one boosted tick burns 0.075: 10.1 → 10.025, one more boosted step, then none
    const tunables = { ...DEFAULT_TUNABLES, npcCount: 0, minLength: 10, startLength: 10.1 };
    const sim = new GameWorldSim({ seed: 7, tunables });
    sim.addPlayer("p1", null);
    const first = sim.step().snapshot.players[0];
    if (first === undefined) throw new Error("no snapshot");
    sim.queueInputs("p1", [{ seq: 1, dx: first.dx, dy: first.dy, boost: true }]);
    const snap = sim.step().snapshot.players[0];
    if (snap === undefined) throw new Error("no snapshot");
    // tenths would say 10.0, and the client would predict a base step (9 px) where the server boosts (16 px)
    expect(snap.len).toBe(Math.fround(10.025));

    const predictor = new LocalPredictor(tunables, sim.dt);
    predictor.initFromSnap(snap);
    for (let i = 0; i < 3; i++) {
      const [message] = predictor.renderFrame(sim.dt, () => ({
        dx: snap.dx,
        dy: snap.dy,
        boost: true,
      }));
      sim.queueInputs("p1", message ?? []);
      const next = sim.step().snapshot.players[0];
      if (next === undefined) throw new Error("no snapshot");
      expect(predictor.onServerSnap(next).magnitudePx).toBeLessThan(0.2);
    }
  });
});
