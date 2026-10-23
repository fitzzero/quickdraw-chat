/**
 * InputQueue — one snake's input frames, each stepped exactly once.
 *
 * A client steps its prediction once per frame at the tick rate and sends
 * every message with its newest frame last and up to three unacknowledged
 * ones before it (a lost message's frames ride the next ones). The server
 * queues each frame once, by seq, and the sim steps the snake once per frame
 * it takes, so `PlayerSnap.ack` names a frame stepped exactly once and the
 * client's replay from it reproduces the client's own position.
 *
 * Frames are taken against a credit: each tick refills it by `1 + 3 * dt`
 * (1.15 at 20 Hz), capped at 15, and each frame taken spends one, at most
 * three a tick. A backlog therefore drains 15% faster than a client fills
 * it: a client whose clock runs fast settles at a queue of 0 to 1 frames
 * instead of growing one, and a slow one starves a tick now and then (its
 * snake skips that step, never coasting on an older intent). The credit is
 * also the ceiling a client sending frames faster than real time meets: 15%
 * over the tick rate on average.
 */

import type { GameInput } from "@project/shared";

/** Frames a queue holds; past it the oldest gives way. */
export const INPUT_QUEUE_CAP = 15;
/** The most a queue's credit holds, and what a new queue starts with. */
export const INPUT_CREDIT_CAP = 15;
/** Frames a snake steps in one tick at most. */
export const MAX_STEPS_PER_TICK = 3;

export class InputQueue {
  private readonly frames: GameInput[] = [];
  private credit = INPUT_CREDIT_CAP;
  /** The seq of the last frame taken: what the snapshot acknowledges. */
  private taken: number;
  /** Frames at or below this seq are ignored: taken ones, and ones the cap pushed out. */
  private floor: number;

  constructor(lastSeq = 0) {
    this.taken = lastSeq;
    this.floor = lastSeq;
  }

  /** The seq of the last frame stepped (0 before any). */
  public get lastSeq(): number {
    return this.taken;
  }

  /** Frames still queued. */
  public depth(): number {
    return this.frames.length;
  }

  /**
   * Queues a frame in seq order. A frame at or below the last one taken, or
   * one queued already, is ignored; at the cap the oldest queued frame gives
   * way (it is never stepped, and the client's replay corrects for it).
   */
  public push(frame: GameInput): void {
    if (frame.seq <= this.floor) return;
    let at = this.frames.length;
    while (at > 0 && (this.frames[at - 1]?.seq ?? 0) > frame.seq) at--;
    if (at > 0 && this.frames[at - 1]?.seq === frame.seq) return;
    this.frames.splice(at, 0, frame);
    if (this.frames.length > INPUT_QUEUE_CAP) {
      const dropped = this.frames.shift();
      if (dropped) this.floor = dropped.seq;
    }
  }

  /**
   * The frames to step this tick, oldest first: refills the credit by
   * `1 + 3 * dt` (capped), then takes one frame per whole credit, at most
   * MAX_STEPS_PER_TICK. An empty queue gives none.
   */
  public take(dt: number): GameInput[] {
    this.credit = Math.min(INPUT_CREDIT_CAP, this.credit + 3 * dt + 1);
    const out: GameInput[] = [];
    while (out.length < MAX_STEPS_PER_TICK && this.credit >= 1) {
      const frame = this.frames.shift();
      if (!frame) break;
      this.credit -= 1;
      this.taken = frame.seq;
      this.floor = Math.max(this.floor, frame.seq);
      out.push(frame);
    }
    return out;
  }

  /** Drops the queued frames (the snake died or spawned again); their seqs stay ignored once taken. */
  public clear(): void {
    this.frames.length = 0;
  }
}
