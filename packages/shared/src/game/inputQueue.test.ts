import { describe, expect, it } from "vitest";
import type { GameInput } from "../types/game.js";
import {
  HOLD_TICKS,
  INPUT_CREDIT_CAP,
  INPUT_QUEUE_CAP,
  InputQueue,
  MAX_STEPS_PER_TICK,
} from "./inputQueue.js";

const DT = 1 / 20;

/** Deterministic PRNG (mulberry32), so the arrival sweep below is the same every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frame(seq: number): GameInput {
  return { seq, dx: 1, dy: 0, boost: false };
}

function seqs(frames: GameInput[]): number[] {
  return frames.map((f) => f.seq);
}

/** Takes as the sim does: a take that gives nothing is a coasted tick. */
function tick(queue: InputQueue): number[] {
  const taken = queue.take(DT);
  if (taken.length === 0) queue.coast();
  return seqs(taken);
}

describe("InputQueue", () => {
  it("steps frames in seq order, whatever order they arrived in", () => {
    const queue = new InputQueue();
    for (const seq of [3, 1, 2]) queue.push(frame(seq));
    // two queued after the first are a backlog: a second steps with it
    expect(tick(queue)).toEqual([1, 2]);
    expect(tick(queue)).toEqual([3]);
    expect(queue.lastSeq).toBe(3);
  });

  it("queues each frame once: a repeated seq, or one at or below the last taken, is ignored", () => {
    const queue = new InputQueue();
    queue.push(frame(1));
    queue.push(frame(1));
    expect(tick(queue)).toEqual([1]);
    // the next message repeats it, with one new frame
    for (const seq of [1, 2]) queue.push(frame(seq));
    expect(tick(queue)).toEqual([2]);
    // a regression
    queue.push(frame(1));
    expect(queue.depth()).toBe(0);
    expect(queue.lastSeq).toBe(2);
  });

  it("holds at most INPUT_QUEUE_CAP frames, the oldest giving way for good", () => {
    const queue = new InputQueue();
    for (let seq = 1; seq <= INPUT_QUEUE_CAP + 5; seq++) queue.push(frame(seq));
    expect(queue.depth()).toBe(INPUT_QUEUE_CAP);
    // a pushed-out frame arriving again stays out
    queue.push(frame(5));
    expect(queue.depth()).toBe(INPUT_QUEUE_CAP);
    expect(tick(queue)).toEqual([6, 7, 8]);
  });

  it("steps a backlog at most MAX_STEPS_PER_TICK a tick, keeping its last frame for its own tick", () => {
    const queue = new InputQueue();
    for (let seq = 1; seq <= MAX_STEPS_PER_TICK + 2; seq++) queue.push(frame(seq));
    expect(tick(queue)).toHaveLength(MAX_STEPS_PER_TICK);
    expect(tick(queue)).toEqual([MAX_STEPS_PER_TICK + 1]);
    expect(tick(queue)).toEqual([MAX_STEPS_PER_TICK + 2]);
    expect(queue.depth()).toBe(0);
  });

  it("holds an early frame for its own tick: two frames, then none, step one a tick", () => {
    const queue = new InputQueue();
    queue.push(frame(1));
    queue.push(frame(2));
    expect(tick(queue)).toEqual([1]);
    expect(tick(queue)).toEqual([2]);
  });

  it("coasts on a tick without a frame, standing in for the late frame, which is ignored when it arrives", () => {
    const queue = new InputQueue(4);
    // tick 5 has no frame: the sim coasts, and the ack covers frame 5
    expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(5);
    // frame 5 arrives late, with frame 6: its step was the coast
    queue.push(frame(5));
    queue.push(frame(6));
    expect(tick(queue)).toEqual([6]);
    expect(queue.lastSeq).toBe(6);
    expect(queue.depth()).toBe(0);
  });

  it("stands in on every coast: the frame it stood in for is never stepped, alone or not", () => {
    const queue = new InputQueue(4);
    expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(5);
    // frame 5 comes alone (a client behind, not just late): refused all the
    // same, and the tick coasts again, standing in for frame 6
    expect(queue.push(frame(5))).toBe(false);
    expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(6);
    // frame 6 comes alone too: refused; frame 7, in before the tick, steps
    expect(queue.push(frame(6))).toBe(false);
    expect(queue.push(frame(7))).toBe(true);
    expect(tick(queue)).toEqual([7]);
    expect(queue.lastSeq).toBe(7);
    expect(queue.depth()).toBe(0);
  });

  it("keeps the ack counting the steps at every arrival phase, jitter and clock drift", () => {
    // A client at 20 Hz whose frames land `phase` ms into the server's tick
    // interval, each ± `jitter` ms, on a clock `drift` ppm fast (negative:
    // slow), its message repeating the three frames before its newest. The
    // steps the server took and the ack must agree after every tick: the
    // first queue let them drift apart by one, about 40 times a minute for a
    // client on the tick boundary, each a whole-step correction on its snake.
    const violations = (phase: number, jitter: number, drift: number): number => {
      const rng = mulberry32(1);
      const queue = new InputQueue();
      const period = 50 * (1 - drift / 1e6);
      const arrivals = Array.from({ length: 2100 }, (_, i) => ({
        t: (i + 1) * period + phase + (rng() * 2 - 1) * jitter,
        seq: i + 1,
      }));
      let next = 0;
      let steps = 0;
      let fed = false;
      let count = 0;
      for (let t = 1; t <= 2000; t++) {
        const now = t * 50;
        for (; next < arrivals.length && (arrivals[next]?.t ?? Infinity) <= now; next++) {
          const newest = arrivals[next]?.seq ?? 0;
          for (let seq = Math.max(1, newest - 3); seq <= newest; seq++) queue.push(frame(seq));
        }
        const taken = queue.take(DT);
        if (taken.length > 0) {
          fed = true;
          steps += taken.length;
        } else if (fed) {
          steps += 1;
          queue.coast();
        }
        if (fed && steps !== queue.lastSeq) count++;
      }
      return count;
    };
    for (const drift of [0, 1000, -1000]) {
      for (const jitter of [0, 3, 8, 17, 25]) {
        for (const phase of [5, 25, 45, 49]) {
          expect(
            violations(phase, jitter, drift),
            `phase ${phase} ms, jitter ±${jitter} ms, drift ${drift} ppm`,
          ).toBe(0);
        }
      }
    }
  });

  it("stands in for every coast while the client is silent, and ignores its stalled frames", () => {
    const queue = new InputQueue(4);
    // a second without a frame (an uplink stall)
    for (let i = 0; i < 20; i++) expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(24);
    // the stalled messages arrive at once: the frames the coasts stood in for
    // are ignored, and only the two after them step, one a tick
    for (let seq = 5; seq <= 26; seq++) queue.push(frame(seq));
    expect(tick(queue)).toEqual([25]);
    expect(tick(queue)).toEqual([26]);
    expect(queue.lastSeq).toBe(26);
  });

  it("spends credit on coasts too: holding frames back to send in bursts earns no extra steps", () => {
    const queue = new InputQueue();
    let steps = 0;
    for (let t = 0; t < 800; t++) {
      // two silent ticks, then four frames at once, numbered past the ack
      if (t % 4 === 2) {
        const from = queue.lastSeq + 1;
        for (let seq = from; seq < from + 4; seq++) queue.push(frame(seq));
      }
      const taken = tick(queue);
      steps += taken.length === 0 ? 1 : taken.length;
    }
    // the starting credit aside, at most 1 + 3·dt steps a tick (it would be 1.5)
    expect(steps).toBeLessThanOrEqual(800 * (1 + 3 * DT) + INPUT_CREDIT_CAP);
  });

  it("steps a frame that waited HOLD_TICKS ticks without a tick needing it with the next one", () => {
    const queue = new InputQueue();
    // a client one frame ahead
    queue.push(frame(1));
    queue.push(frame(2));
    const taken = [tick(queue)];
    for (let seq = 3; seq <= HOLD_TICKS + 3; seq++) {
      queue.push(frame(seq));
      taken.push(tick(queue));
    }
    expect(taken.slice(0, HOLD_TICKS).every((t) => t.length === 1)).toBe(true);
    expect(taken[HOLD_TICKS]).toHaveLength(2);
    expect(queue.depth()).toBe(0);
  });

  it("clears its frames and keeps its ack (a snake that spawned again)", () => {
    const queue = new InputQueue();
    for (const seq of [1, 2]) queue.push(frame(seq));
    tick(queue);
    queue.clear();
    expect(queue.depth()).toBe(0);
    expect(queue.lastSeq).toBe(1);
    queue.push(frame(2));
    queue.push(frame(3));
    expect(tick(queue)).toEqual([2]);
  });

  it("drains a sustained backlog at 1 + 3·dt frames a tick (1.15 at 20 Hz)", () => {
    const queue = new InputQueue();
    let next = 0;
    const takenPerTick: number[] = [];
    for (let t = 0; t < 300; t++) {
      // a client far ahead keeps the queue full
      while (queue.depth() < INPUT_QUEUE_CAP) queue.push(frame(++next));
      takenPerTick.push(tick(queue).length);
    }
    // three a tick while the starting credit lasts, then the refill sets the pace
    expect(takenPerTick.slice(0, 3)).toEqual([3, 3, 3]);
    const late = takenPerTick.slice(100).reduce((sum, n) => sum + n, 0);
    expect(late / 200).toBeCloseTo(1 + 3 * DT, 1);
  });

  it("holds a client 1% fast near an empty queue, and coasts for each frame a 1% slow one misses, which numbers past the coast", () => {
    const run = (
      scale: number,
    ): { coasted: number; deepest: number; refused: number; apart: number } => {
      const queue = new InputQueue();
      let due = 0;
      let next = 0;
      let coasted = 0;
      let steps = 0;
      let deepest = 0;
      let refused = 0;
      let apart = 0;
      for (let t = 0; t < 2000; t++) {
        due += scale;
        while (due >= 1) {
          due -= 1;
          // the client numbers its next frame after an ack that ran past its
          // newest (local_snake.gd, prediction.ts)
          if (queue.lastSeq > next) next = queue.lastSeq;
          if (!queue.push(frame(++next))) refused++;
        }
        const taken = tick(queue);
        if (taken.length === 0) coasted++;
        steps += taken.length === 0 ? 1 : taken.length;
        deepest = Math.max(deepest, queue.depth());
        if (steps !== queue.lastSeq) apart++;
      }
      return { coasted, deepest, refused, apart };
    };
    // fast: an extra frame waits, then steps with the next one
    expect(run(1.01)).toEqual({ coasted: 0, deepest: 1, refused: 0, apart: 0 });
    // slow: a tick now and then has no frame and coasts, standing in for the
    // client's next frame; the client, seeing the ack past its newest,
    // numbers its next frame after it, so no frame of its is late or
    // refused, and the ack never parts from the steps
    const slow = run(0.99);
    expect(slow.coasted).toBeGreaterThanOrEqual(20);
    expect(slow.coasted).toBeLessThanOrEqual(25);
    expect(slow.refused).toBe(0);
    expect(slow.deepest).toBe(0);
    expect(slow.apart).toBe(0);
  });
});
