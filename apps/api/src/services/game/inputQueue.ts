/**
 * InputQueue — one snake's input frames, stepped one movement step a tick.
 *
 * A client steps its prediction once per frame at the tick rate and sends
 * every message with its newest frame last and up to three unacknowledged
 * ones before it (a lost message's frames ride the next ones). The server
 * queues each frame once, by seq, and steps the snake one frame a tick, so
 * `PlayerSnap.ack` names the last frame stepped and the client's replay from
 * it reproduces the client's own position.
 *
 * Frames reach the server with the jitter of the client's frame loop (up to
 * a render frame, about 17 ms) and of the network, so a client whose frames
 * land near the server's tick sees them flip between ticks. Stepping what
 * arrived would then move its snake twice in one tick and not at all in the
 * next, a stutter every other player sees. Instead:
 *
 * - A frame that arrives early (two in one tick) waits for the next tick, at
 *   most one: a frame that has waited a tick steps with the next one.
 * - A tick with no frame coasts: the sim steps the snake on its last intent
 *   and the queue owes that step. The late frame is skipped when the queue
 *   holds more than it needs, so the snake keeps one step a tick and the
 *   client corrects only the difference in intent. A debt not paid within
 *   OWED_TICKS ticks expires: a client whose clock runs slow never sends the
 *   extra frame.
 *
 * Frames are also taken against a credit: each tick refills it by
 * `1 + 3 * dt` (1.15 at 20 Hz), capped at 15, and each frame stepped spends
 * one, at most three a tick. A client sending frames faster than real time
 * moves at most 15% faster on average.
 */

import type { GameInput } from "@project/shared";

/** Frames a queue holds; past it the oldest gives way. */
export const INPUT_QUEUE_CAP = 15;
/** The most a queue's credit holds, and what a new queue starts with. */
export const INPUT_CREDIT_CAP = 15;
/** Frames a snake steps in one tick at most. */
export const MAX_STEPS_PER_TICK = 3;
/** Coasted steps a queue owes at most. */
export const OWED_CAP = 4;
/** Ticks after the last coast that its steps stay owed. */
export const OWED_TICKS = 4;

export class InputQueue {
  private readonly frames: GameInput[] = [];
  private credit = INPUT_CREDIT_CAP;
  /** The seq of the last frame stepped or skipped: what the snapshot acknowledges. */
  private taken: number;
  /** Frames at or below this seq are ignored: taken ones, and ones the cap pushed out. */
  private floor: number;
  /** Frames left queued by the last take: they have waited a tick. */
  private carried = 0;
  /** Coasted steps not yet matched by a skipped late frame, and ticks since the last coast. */
  private owed = 0;
  private owedFor = 0;

  constructor(lastSeq = 0) {
    this.taken = lastSeq;
    this.floor = lastSeq;
  }

  /** The seq of the last frame stepped or skipped (0 before any). */
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
   * The frames to step this tick, oldest first: one, plus one for each frame
   * that waited a tick already, at most MAX_STEPS_PER_TICK and one per whole
   * credit (refilled by `1 + 3 * dt`). Late frames for coasted steps are
   * skipped first, while more than one frame is queued. An empty queue gives
   * none: the sim coasts and calls `coast()`.
   */
  public take(dt: number): GameInput[] {
    this.credit = Math.min(INPUT_CREDIT_CAP, this.credit + 3 * dt + 1);
    while (this.owed > 0 && this.frames.length >= 2) {
      const late = this.frames.shift();
      if (!late) break;
      this.owed--;
      this.passed(late);
    }
    const out: GameInput[] = [];
    const allowed = Math.min(MAX_STEPS_PER_TICK, 1 + this.carried);
    while (out.length < allowed && this.credit >= 1) {
      const frame = this.frames.shift();
      if (!frame) break;
      this.credit -= 1;
      this.passed(frame);
      out.push(frame);
    }
    this.carried = this.frames.length;
    if (this.owed > 0 && ++this.owedFor >= OWED_TICKS) this.owed = 0;
    return out;
  }

  /** The sim stepped the snake without a frame: the late frame is owed. */
  public coast(): void {
    this.owed = Math.min(OWED_CAP, this.owed + 1);
    this.owedFor = 0;
  }

  /** Drops the queued frames and what was owed (the snake died or spawned again); taken seqs stay ignored. */
  public clear(): void {
    this.frames.length = 0;
    this.carried = 0;
    this.owed = 0;
  }

  private passed(frame: GameInput): void {
    this.taken = frame.seq;
    this.floor = Math.max(this.floor, frame.seq);
  }
}
