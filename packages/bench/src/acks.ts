/**
 * The input → ack pairing behind `packet.inputAckRttMs`: an input's
 * `tAcked` is the arrival of the first own snapshot whose ack is at or past
 * its seq, oldest input first. The bots pair them live, as their core
 * reconciles (apps/api/src/bench/bot/client.ts, `onCorrection`); the
 * browser tier's runner pairs a page's sends with its corrections' acks
 * after the run (apps/bench-web/src/run.ts): the core reconciles the local
 * snake against every own snapshot, and the page's telemetry sends each
 * one's ack.
 */

import type { ClientTrace } from "./types.js";

/** One own snapshot's arrival, and the last input frame its state holds (`PlayerSnap.ack`). */
export interface AckArrival {
  tWall: number;
  ack: number;
}

/**
 * Sets `tAcked` on each input the arrivals acknowledge, both lists in time
 * order. An input waits for the arrivals after it was sent; each arrival
 * acknowledges the waiting inputs up to its ack, oldest first, and stops at
 * the first one past it, as the bots' queue does.
 */
export function ackInputs(inputs: ClientTrace["inputs"], arrivals: readonly AckArrival[]): void {
  // the oldest input waiting for an ack, and the end of those sent before the arrival in hand
  let waiting = 0;
  let sent = 0;
  for (const { tWall, ack } of arrivals) {
    while (sent < inputs.length && (inputs[sent]?.tSent ?? Infinity) < tWall) sent += 1;
    while (waiting < sent) {
      const input = inputs[waiting];
      if (input === undefined || input.seq > ack) break;
      input.tAcked = tWall;
      waiting += 1;
    }
  }
}
