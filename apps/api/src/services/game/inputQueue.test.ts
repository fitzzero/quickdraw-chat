import { describe, expect, it } from "vitest";
import type { GameInput } from "@project/shared";
import { INPUT_QUEUE_CAP, InputQueue, MAX_STEPS_PER_TICK, OWED_TICKS } from "./inputQueue.js";

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
    expect(tick(queue)).toEqual([1]);
    // the two that waited a tick step with the next
    expect(tick(queue)).toEqual([2, 3]);
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
    expect(tick(queue)).toEqual([6]);
  });

  it("steps one frame a tick, and one more for each that waited, at most MAX_STEPS_PER_TICK", () => {
    const queue = new InputQueue();
    for (let seq = 1; seq <= MAX_STEPS_PER_TICK + 2; seq++) queue.push(frame(seq));
    expect(tick(queue)).toEqual([1]);
    expect(queue.depth()).toBe(MAX_STEPS_PER_TICK + 1);
    expect(tick(queue)).toHaveLength(MAX_STEPS_PER_TICK);
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

  it("skips a coasted tick's late frame once the queue holds more than it needs", () => {
    const queue = new InputQueue(4);
    // tick 5 has no frame: the sim coasts on the last intent
    expect(tick(queue)).toEqual([]);
    // frame 5 arrives late, with frame 6: its step was the coast
    queue.push(frame(5));
    queue.push(frame(6));
    expect(tick(queue)).toEqual([6]);
    expect(queue.lastSeq).toBe(6);
    // a copy of frame 5 in a later message is ignored
    queue.push(frame(5));
    expect(queue.depth()).toBe(0);
  });

  it("pays a coasted step only from excess: a late frame alone steps, and the debt expires", () => {
    const queue = new InputQueue(4);
    expect(tick(queue)).toEqual([]);
    // the late frame arrives alone: stepped, not skipped
    queue.push(frame(5));
    expect(tick(queue)).toEqual([5]);
    for (let seq = 6; seq < 6 + OWED_TICKS; seq++) {
      queue.push(frame(seq));
      expect(tick(queue)).toEqual([seq]);
    }
    // the debt expired: two frames now are an early one, not a late one
    queue.push(frame(6 + OWED_TICKS));
    queue.push(frame(7 + OWED_TICKS));
    expect(tick(queue)).toEqual([6 + OWED_TICKS]);
  });

  it("clears its frames and what it owes, and keeps its ack (a snake that spawned again)", () => {
    const queue = new InputQueue();
    for (const seq of [1, 2, 3]) queue.push(frame(seq));
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
    // one, then three a tick while the starting credit lasts, then the refill sets the pace
    expect(takenPerTick.slice(0, 3)).toEqual([1, 3, 3]);
    const late = takenPerTick.slice(100).reduce((sum, n) => sum + n, 0);
    expect(late / 200).toBeCloseTo(1 + 3 * DT, 1);
  });

  it("holds a client 1% fast near an empty queue, and coasts one 1% slow once in about 100 ticks", () => {
    const run = (scale: number) => {
      const queue = new InputQueue();
      let owed = 0;
      let next = 0;
      let coasted = 0;
      let stepped = 0;
      let deepest = 0;
      for (let t = 0; t < 2000; t++) {
        owed += scale;
        while (owed >= 1) {
          owed -= 1;
          queue.push(frame(++next));
        }
        const taken = tick(queue);
        if (taken.length === 0) coasted++;
        stepped += taken.length;
        deepest = Math.max(deepest, queue.depth());
      }
      return { coasted, deepest, missed: next - queue.depth() - stepped };
    };
    // fast: an extra frame waits a tick, then steps with the next
    expect(run(1.01)).toEqual({ coasted: 0, deepest: 1, missed: 0 });
    // slow: a tick now and then has no frame and coasts; no frame is ever
    // skipped, since none arrives in excess
    const slow = run(0.99);
    expect(slow.coasted).toBeGreaterThanOrEqual(15);
    expect(slow.coasted).toBeLessThanOrEqual(25);
    expect(slow.missed).toBe(0);
    expect(slow.deepest).toBe(0);
  });
});
