import { describe, expect, it } from "vitest";
import type { GameInput } from "@project/shared";
import {
  COAST_CAP,
  HOLD_TICKS,
  INPUT_QUEUE_CAP,
  InputQueue,
  MAX_STEPS_PER_TICK,
  OWED_TICKS,
} from "./inputQueue.js";

const DT = 1 / 20;

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

  it("owes the next coast when the stood-in frame comes alone (a client behind), and steps the frame after it", () => {
    const queue = new InputQueue(4);
    expect(tick(queue)).toEqual([]);
    // frame 5 comes with nothing after it: the client is behind, not late
    queue.push(frame(5));
    expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(6);
    // so frame 6 still steps: the owed coast was a step of its own
    queue.push(frame(6));
    expect(tick(queue)).toEqual([6]);
    queue.push(frame(7));
    expect(tick(queue)).toEqual([7]);
  });

  it("pays an owed step with a frame that arrives with another after it", () => {
    const queue = new InputQueue(4);
    tick(queue);
    queue.push(frame(5));
    tick(queue);
    // frames 6 and 7 together: 6 is skipped (its step was the owed coast)
    queue.push(frame(6));
    queue.push(frame(7));
    expect(tick(queue)).toEqual([7]);
    expect(queue.lastSeq).toBe(7);
  });

  it("lets an owed step expire after OWED_TICKS ticks", () => {
    const queue = new InputQueue(4);
    tick(queue);
    queue.push(frame(5));
    tick(queue);
    for (let seq = 6; seq < 6 + OWED_TICKS; seq++) {
      queue.push(frame(seq));
      expect(tick(queue)).toEqual([seq]);
    }
    // the debt expired: two frames now are an early one, not a late one
    queue.push(frame(6 + OWED_TICKS));
    queue.push(frame(7 + OWED_TICKS));
    expect(tick(queue)).toEqual([6 + OWED_TICKS]);
  });

  it("stands in for at most COAST_CAP coasts in a row; the coasts after them are owed", () => {
    const queue = new InputQueue(4);
    // the client stops sending
    for (let i = 0; i < COAST_CAP + 1; i++) expect(tick(queue)).toEqual([]);
    expect(queue.lastSeq).toBe(5 + COAST_CAP);
    // it comes back with a burst: the stood-in frames are ignored, the owed
    // one pays its step, the newest steps
    for (let seq = 5; seq <= 6 + COAST_CAP; seq++) queue.push(frame(seq));
    expect(tick(queue)).toEqual([6 + COAST_CAP]);
    expect(queue.depth()).toBe(0);
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

  it("clears its frames and what it owes, and keeps its ack (a snake that spawned again)", () => {
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

  it("holds a client 1% fast near an empty queue, and coasts twice for each frame a 1% slow one misses", () => {
    const run = (scale: number) => {
      const queue = new InputQueue();
      let due = 0;
      let next = 0;
      let coasted = 0;
      let stepped = 0;
      let deepest = 0;
      for (let t = 0; t < 2000; t++) {
        due += scale;
        while (due >= 1) {
          due -= 1;
          queue.push(frame(++next));
        }
        const taken = tick(queue);
        if (taken.length === 0) coasted++;
        stepped += taken.length;
        deepest = Math.max(deepest, queue.depth());
      }
      return { coasted, deepest, missed: next - queue.depth() - stepped };
    };
    // fast: an extra frame waits, then steps with the next one
    expect(run(1.01)).toEqual({ coasted: 0, deepest: 1, missed: 0 });
    // slow: a tick now and then has no frame and coasts, standing in for the
    // frame that comes alone on the next; the next coast is owed, and the
    // frame after it steps
    const slow = run(0.99);
    expect(slow.missed).toBeGreaterThanOrEqual(15);
    expect(slow.missed).toBeLessThanOrEqual(25);
    // two coasts each (the run may end between the two of its last)
    expect(slow.coasted - 2 * slow.missed).toBeGreaterThanOrEqual(0);
    expect(slow.coasted - 2 * slow.missed).toBeLessThanOrEqual(1);
    expect(slow.deepest).toBe(0);
  });
});
