/**
 * The bots' prediction against the shared sim: a client that replays from
 * the snapshot decides each step as the server does, so a server step it
 * predicted costs no correction.
 */

import type { PlayerSnap } from "@project/shared";
import { DEFAULT_TUNABLES, GAME_TICK_RATE, GameWorldSim } from "@project/shared";
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

  it("moves its frame clock half a tick earlier when the server keeps saying late, at most once per half second", () => {
    const tunables = { ...DEFAULT_TUNABLES, npcCount: 0 };
    const dt = 1 / GAME_TICK_RATE;
    const predictor = new LocalPredictor(tunables, dt);
    const snap = { id: "p1", x: 500, y: 500, dx: 1, dy: 0, len: 10, boost: false, ack: 100 };
    predictor.initFromSnap(snap);
    const aim = () => ({ dx: 1, dy: 0, boost: false });
    // one frame out (the snake moves), then 10 ms into the next tick
    expect(predictor.renderFrame(dt, aim)).toHaveLength(1);
    predictor.renderFrame(0.01, aim);
    const seen = predictor.getRenderedPos();
    const at = (s: PlayerSnap) => ({ ...s, x: predictor.simPos.x, y: predictor.simPos.y });

    // no word of the server's, no nudge: an ack past the newest frame alone is
    // also what a round trip under a tick looks like; nor one late now and then
    expect(predictor.onServerSnap(at({ ...snap, ack: 102 })).nudged).toBe(false);
    expect(predictor.onServerSnap(at({ ...snap, ack: 102, late: true })).nudged).toBe(false);
    for (let i = 0; i < 40; i++) predictor.onServerSnap(at({ ...snap, ack: 102, late: false }));
    // late on a fifth of the snapshots, averaged over about a second: the fifth late in a row
    const nudges = Array.from({ length: 5 }, () =>
      predictor.onServerSnap(at({ ...snap, ack: 102, late: true })),
    ).map((c) => c.nudged);
    expect(nudges).toEqual([false, false, false, false, true]);
    // what the player sees stays put, and the frame clock gains the half tick
    // over a quarter second, 10 % faster: frames leave 25 ms earlier after it
    predictor.renderFrame(0, aim);
    expect(predictor.getRenderedPos().x).toBeCloseTo(seen.x, 6);
    // 10 ms into the tick, 270 ms on and 25 ms gained: 305 ms of frame clock, six
    // frames, where without the nudge 280 ms would make five
    let frames = 0;
    for (let i = 0; i < 27; i++) frames += predictor.renderFrame(0.01, aim).length;
    expect(frames).toBe(6);

    // late again at once: not within half a second (ten frames) of the last nudge
    for (let i = 0; i < 6; i++) {
      expect(predictor.onServerSnap(at({ ...snap, ack: 103, late: true })).nudged).toBe(false);
    }
    for (let i = 0; i < 9; i++) predictor.renderFrame(dt, aim);
    expect(predictor.onServerSnap(at({ ...snap, ack: 103, late: true })).nudged).toBe(true);
  });
});
