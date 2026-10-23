/**
 * InputQueue — one snake's input frames, one movement step a tick.
 *
 * A client steps its prediction once per frame at the tick rate and sends
 * every message with its newest frame last and up to three unacknowledged
 * ones before it (a lost message's frames ride the next ones). The server
 * queues each frame once, by seq, and steps the snake once for each, so
 * `PlayerSnap.ack` names the last frame the server's state holds and the
 * client's replay from it reproduces the client's own position.
 *
 * Frames reach the server with the jitter of the client's frame loop (up to
 * a render frame, about 17 ms) and of the network, so a client whose frames
 * land near the server's tick sees them flip between ticks. Stepping what
 * arrived would then move its snake twice in one tick and not at all in the
 * next, a stutter every other player sees. Instead the snake steps once a
 * tick:
 *
 * - A tick without a frame coasts: the sim steps the snake on its last
 *   intent, and that step stands in for the client's next frame, which is
 *   ignored when it arrives. The client corrects only the difference in
 *   intent of that one frame. At most COAST_CAP ticks in a row stand in, so
 *   a client that stops sending (a paused tab) loses no more frames than
 *   that when it comes back.
 * - A frame that arrives early (two in one tick) waits for its own tick. A
 *   second frame steps in one tick only from a backlog (two or more queued
 *   after the first), or once a frame has waited HOLD_TICKS ticks without a
 *   tick needing it: a client whose clock runs fast drains its extra frames
 *   that way.
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
/** Coasted ticks in a row that stand in for a frame each. */
export const COAST_CAP = Number(process.env.QD_COAST_CAP ?? 4);
/** Coasted steps a queue owes at most. */
export const OWED_CAP = 4;
/** Ticks after the last owed coast that its step stays owed. */
export const OWED_TICKS = 4;
/** PROTOTYPE (H2): ticks a frame waits without a tick needing it before it steps with the next. */
export const HOLD_TICKS = Number(process.env.QD_HOLD_TICKS ?? 10);

export class InputQueue {
  private readonly frames: GameInput[] = [];
  private credit = INPUT_CREDIT_CAP;
  /** The seq of the last frame stepped or stood in for: what the snapshot acknowledges. */
  private taken: number;
  /** Frames at or below this seq are ignored: taken ones, and ones the cap pushed out. */
  private floor: number;
  /** Ticks in a row that ended with a frame still queued. */
  private held = 0;
  /** Coasted ticks in a row that stood in for a frame. */
  private standIns = 0;
  /** Coasted steps not matched by a skipped frame yet, and ticks since the last. */
  private owed = 0;
  private owedFor = 0;
  /** The newest seq the client sent (ignored frames included). */
  private newest = 0;

  constructor(lastSeq = 0) {
    this.taken = lastSeq;
    this.floor = lastSeq;
  }

  /** The seq of the last frame stepped or stood in for (0 before any). */
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
   * The frames to step this tick, oldest first: one, a second only from a
   * backlog or to drain a frame that waited HOLD_TICKS ticks, at most
   * MAX_STEPS_PER_TICK and one per whole credit (refilled by `1 + 3 * dt`).
   * An empty queue gives none: the sim coasts and calls `coast()`.
   */
  public take(dt: number): GameInput[] {
    this.credit = Math.min(INPUT_CREDIT_CAP, this.credit + 3 * dt + 1);
    // PROTOTYPE (H2): an owed step is paid by a frame that arrived with another after it
    while (this.owed > 0 && this.frames.length >= 2) {
      const late = this.frames.shift();
      if (!late) break;
      this.owed--;
      this.passed(late.seq);
    }
    const out: GameInput[] = [];
    const drain = this.held >= HOLD_TICKS;
    while (out.length < MAX_STEPS_PER_TICK && this.credit >= 1) {
      if (out.length > 0 && this.frames.length < 2 && !(drain && out.length === 1)) break;
      const frame = this.frames.shift();
      if (!frame) break;
      this.credit -= 1;
      this.passed(frame.seq);
      out.push(frame);
    }
    this.held = this.frames.length > 0 && !drain ? this.held + 1 : 0;
    if (out.length > 0) this.standIns = 0;
    if (this.owed > 0 && ++this.owedFor >= OWED_TICKS) this.owed = 0;
    return out;
  }

  /** The sim stepped the snake on its last intent: the step stands in for the next frame. */
  public coast(): void {
    // PROTOTYPE (H2): the frame the last coast stood in for came with nothing after it: the
    // client is behind, not late, so this step is owed instead (its frame still steps)
    const behind = this.standIns > 0 && this.newest >= this.taken;
    if (this.owed === 0 && !behind && this.standIns < COAST_CAP) {
      this.standIns++;
      this.passed(this.taken + 1);
      return;
    }
    this.owed = Math.min(OWED_CAP, this.owed + 1);
    this.owedFor = 0;
    this.taken += 1;
  }

  /** Drops the queued frames (the snake died or spawned again); taken seqs stay ignored. */
  public clear(): void {
    this.frames.length = 0;
    this.held = 0;
    this.standIns = 0;
    this.owed = 0;
  }

  private passed(seq: number): void {
    this.taken = Math.max(this.taken, seq);
    this.floor = Math.max(this.floor, seq);
  }
}
