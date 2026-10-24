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
 * Frames reach the server with the jitter of the client's frame loop (up to
 * a render frame, about 17 ms) and of the network, so a client whose frames
 * land near the server's tick sees them flip between ticks. Stepping what
 * arrived would then move its snake twice in one tick and not at all in the
 * next, a stutter every other player sees. Instead the snake steps once a
 * tick, a backlog aside:
 *
 * - A tick without a frame coasts: the sim steps the snake on its last
 *   intent. When nothing arrived since the last tick (the frame is late, or
 *   the client stalled), the step stands in for the client's next frame,
 *   which is ignored when it arrives: the client corrects only that frame's
 *   difference in intent.
 * - When frames arrived but none can step (the client is behind: its clock
 *   runs slow, or it came back from a pause), the coast is owed instead. A
 *   frame that arrives with another after it pays an owed step and is
 *   skipped; a debt not paid within OWED_TICKS ticks expires, and the client
 *   corrects that one step.
 * - A frame that arrives early (two in one tick) waits for its own tick. A
 *   second frame steps in one tick only from a backlog (two or more queued
 *   after the first), or once a frame has waited HOLD_TICKS ticks without a
 *   tick needing it: a client whose clock runs fast drains its extra frames
 *   that way.
 *
 * Every step is taken against a credit: each tick refills it by `1 + 3 * dt`
 * (1.15 at 20 Hz), capped at 15, and each frame stepped or coast spends one,
 * at most three steps a tick. A client sending frames faster than real time,
 * or holding them back to send in bursts, moves at most 15% faster on
 * average.
 */

import type { GameInput } from "../types/game.js";

/** Frames a queue holds; past it the oldest gives way. */
export const INPUT_QUEUE_CAP = 15;
/** The most a queue's credit holds, and what a new queue starts with. */
export const INPUT_CREDIT_CAP = 15;
/** Frames a snake steps in one tick at most. */
export const MAX_STEPS_PER_TICK = 3;
/** Ticks after the last owed coast that its debt stays. */
export const OWED_TICKS = 4;
/** Ticks a frame waits without a tick needing it before it steps with the next one. */
export const HOLD_TICKS = 10;

export class InputQueue {
  private readonly frames: GameInput[] = [];
  private credit = INPUT_CREDIT_CAP;
  /** The seq of the last frame the snake's state holds (stepped, skipped or coasted for): the ack. */
  private taken: number;
  /** Frames at or below this seq are ignored: taken ones, stood-in ones, and ones the cap pushed out. */
  private floor: number;
  /** The newest seq the client sent (ignored frames included), and as of the last take. */
  private newest = 0;
  private newestTaken = 0;
  /** A frame arrived between the last two takes. */
  private arrived = false;
  /** Ticks in a row that ended with a frame still queued. */
  private held = 0;
  /** Coasted steps not yet paid by a skipped frame, and ticks since the last one. */
  private owed = 0;
  private owedFor = 0;

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
   * Queues a frame in seq order. A frame at or below the floor (taken, stood
   * in for, or pushed out), or one queued already, is ignored; at the cap
   * the oldest queued frame gives way (it is never stepped, and the client's
   * replay corrects for it).
   */
  public push(frame: GameInput): void {
    this.newest = Math.max(this.newest, frame.seq);
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
   * The frames to step this tick, oldest first. Owed steps are paid first,
   * by skipping frames while two or more are queued. Then one frame, and a
   * second only from a backlog or to drain a frame that waited HOLD_TICKS
   * ticks: at most MAX_STEPS_PER_TICK, and one per whole credit (refilled by
   * `1 + 3 * dt`). An empty queue gives none: the sim coasts and calls
   * `coast()`.
   */
  public take(dt: number): GameInput[] {
    this.credit = Math.min(INPUT_CREDIT_CAP, this.credit + 3 * dt + 1);
    this.arrived = this.newest > this.newestTaken;
    this.newestTaken = this.newest;
    this.payOwed();
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
    if (this.owed > 0 && ++this.owedFor >= OWED_TICKS) this.owed = 0;
    return out;
  }

  /**
   * The sim stepped the snake on its last intent: the step spends a credit,
   * and stands in for the client's next frame or is owed (see the header).
   * Either way the ack covers it.
   */
  public coast(): void {
    this.credit = Math.max(0, this.credit - 1);
    if (!this.arrived) {
      this.passed(this.taken + 1);
      return;
    }
    this.owed++;
    this.owedFor = 0;
    this.taken += 1;
  }

  /**
   * Drops the queued frames and what is owed (the snake died or spawned
   * again). The ack stays: the client starts again from it, so its frames
   * after it are the ones that arrive.
   */
  public clear(): void {
    this.frames.length = 0;
    this.held = 0;
    this.owed = 0;
    this.newest = this.taken;
    this.newestTaken = this.taken;
  }

  /** Pays owed steps by skipping frames while two or more are queued. */
  private payOwed(): void {
    while (this.owed > 0 && this.frames.length >= 2) {
      const paid = this.frames.shift();
      if (!paid) return;
      this.owed--;
      this.passed(paid.seq);
    }
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
