/**
 * InputQueue — one snake's input frames, one movement step each.
 *
 * A client steps its prediction once per frame at the tick rate and sends
 * every message with its newest frame last and up to three unacknowledged
 * ones before it (a lost message's frames ride the next ones). The server
 * queues each frame once, by seq, and steps the snake once for each, so
 * `PlayerSnap.ack` names the last frame the server's state holds and the
 * client's replay from it reproduces the client's own position, but for the
 * change of intent of a frame a coast stood in for.
 *
 * The one invariant: the ack counts the steps. Every tick `lastSeq` advances
 * by exactly the frames stepped, or by one for a coast. A client replaying
 * its unacknowledged frames from the snapshot then never finds a step more
 * or fewer than it predicted, which would be a correction of a whole
 * movement step (9 px, 50 ms of motion) and is what a player sees as a
 * jolt. Three rules keep it:
 *
 * - A tick without a frame coasts: the sim steps the snake on its last
 *   intent, and the step stands in for the client's next frame, whose seq
 *   is consumed. That frame is never stepped when it arrives (`push`
 *   refuses it), but it steers the next step: the sim adopts its intent
 *   (world.ts `queueInputs`), so a client whose frames keep landing just
 *   after the tick is steered one tick behind its prediction, never a step
 *   behind it.
 * - A frame that arrives early (two in one tick) waits for its own tick. A
 *   second frame steps in one tick only from a backlog (two or more queued
 *   after the first), or once a frame has waited HOLD_TICKS ticks without a
 *   tick needing it: a client whose clock runs fast drains its extra frames
 *   that way.
 * - Every step is taken against a credit: each tick refills it by `1 + 3 * dt`
 *   (1.15 at 20 Hz), capped at 15, and each frame stepped or coast spends one,
 *   at most three steps a tick. A client sending frames faster than real time,
 *   or holding them back to send in bursts, moves at most 15% faster on
 *   average.
 *
 * Frames reach the server with the jitter of the client's frame loop (up to
 * a render frame, about 17 ms) and of the network, so a client whose frames
 * land near the server's tick sees them flip between ticks. The queue's
 * first version let a coast be "owed" in that case (the stood-in frame
 * stepped when it came alone, and a later frame was skipped to pay for it):
 * each such flip moved the ack and the steps apart by one, about once a
 * second for a player on the boundary, which the live game showed as a
 * surge and a stall on 2026-10-24. Every coast stands in now.
 */

import type { GameInput } from "../types/game.js";

/** Frames a queue holds; past it the oldest gives way. */
export const INPUT_QUEUE_CAP = 15;
/** The most a queue's credit holds, and what a new queue starts with. */
export const INPUT_CREDIT_CAP = 15;
/** Frames a snake steps in one tick at most. */
export const MAX_STEPS_PER_TICK = 3;
/** Ticks a frame waits without a tick needing it before it steps with the next one. */
export const HOLD_TICKS = 10;

export class InputQueue {
  private readonly frames: GameInput[] = [];
  private credit = INPUT_CREDIT_CAP;
  /** The seq of the last frame the snake's state holds (stepped or coasted for): the ack. */
  private taken: number;
  /** Frames at or below this seq are refused: taken ones, stood-in ones, and ones the cap pushed out. */
  private floor: number;
  /** Ticks in a row that ended with a frame still queued. */
  private held = 0;

  constructor(lastSeq = 0) {
    this.taken = lastSeq;
    this.floor = lastSeq;
  }

  /** The seq of the last frame the snake's state holds (0 before any). */
  public get lastSeq(): number {
    return this.taken;
  }

  /** Frames still queued. */
  public depth(): number {
    return this.frames.length;
  }

  /**
   * Queues a frame in seq order and says whether it was queued. A frame at or
   * below the floor (taken, stood in for, or pushed out), or one queued
   * already, is refused; at the cap the oldest queued frame gives way (it is
   * never stepped, and the client's replay corrects for it). A refused frame
   * for a seq the snake's state holds (`seq <= lastSeq`) is the one a coast
   * stood in for: its intent is the client's newest word, and the sim
   * steers by it (world.ts).
   */
  public push(frame: GameInput): boolean {
    if (frame.seq <= this.floor) return false;
    let at = this.frames.length;
    while (at > 0 && (this.frames[at - 1]?.seq ?? 0) > frame.seq) at--;
    if (at > 0 && this.frames[at - 1]?.seq === frame.seq) return false;
    this.frames.splice(at, 0, frame);
    if (this.frames.length > INPUT_QUEUE_CAP) {
      const dropped = this.frames.shift();
      if (dropped) this.floor = dropped.seq;
      if (dropped === frame) return false;
    }
    return true;
  }

  /**
   * The frames to step this tick, oldest first: one frame, and a second only
   * from a backlog or to drain a frame that waited HOLD_TICKS ticks, at most
   * MAX_STEPS_PER_TICK and one per whole credit (refilled by `1 + 3 * dt`).
   * An empty queue gives none: the sim coasts and calls `coast()`.
   */
  public take(dt: number): GameInput[] {
    this.credit = Math.min(INPUT_CREDIT_CAP, this.credit + 3 * dt + 1);
    const out: GameInput[] = [];
    const drain = this.held >= HOLD_TICKS;
    while (out.length < MAX_STEPS_PER_TICK && this.credit >= 1 && this.mayStep(out.length, drain)) {
      const frame = this.frames.shift();
      if (!frame) break;
      this.credit -= 1;
      this.passed(frame.seq);
      out.push(frame);
    }
    this.held = this.frames.length > 0 && !drain ? this.held + 1 : 0;
    return out;
  }

  /**
   * The sim stepped the snake on its last intent: the step spends a credit
   * and stands in for the client's next frame, whose seq the ack now covers.
   * A frame for that seq is never stepped (one queued meanwhile is dropped).
   */
  public coast(): void {
    this.credit = Math.max(0, this.credit - 1);
    this.passed(this.taken + 1);
    while ((this.frames[0]?.seq ?? Infinity) <= this.floor) this.frames.shift();
  }

  /**
   * Drops the queued frames (the snake died or spawned again). The ack
   * stays: the client starts again from it, so its frames after it are the
   * ones that arrive.
   */
  public clear(): void {
    this.frames.length = 0;
    this.held = 0;
  }

  /** Past a tick's first frame, another steps only from a backlog, or to drain a held one. */
  private mayStep(taken: number, drain: boolean): boolean {
    return taken === 0 || this.frames.length >= 2 || (drain && taken === 1);
  }

  private passed(seq: number): void {
    this.taken = Math.max(this.taken, seq);
    this.floor = Math.max(this.floor, seq);
  }
}
