/**
 * Food parity — whether a client ends with the food the server holds. The
 * world stream is volatile: a dropped snapshot must not leave a piece of
 * food the server removed (a ghost) or miss one it spawned.
 */

import type { ClientReport, ClientTrace, ServerTrace } from "../types.js";

/** A client's food fields: none when its trace holds no food. */
export function computeFood(
  client: ClientTrace,
  server: ServerTrace,
): Pick<ClientReport, "foodMismatchAtEnd" | "foodResyncs"> {
  if (!client.food) return {};
  const mismatch = computeFoodMismatch(client, server);
  return {
    ...(mismatch === undefined ? {} : { foodMismatchAtEnd: mismatch }),
    foodResyncs: client.food.resyncs,
  };
}

/**
 * Food ids the client and the server disagree on at the client's last tick
 * (undefined: the trace holds no food for that tick).
 */
export function computeFoodMismatch(client: ClientTrace, server: ServerTrace): number | undefined {
  const mine = client.food;
  if (!mine) return undefined;
  const theirs = server.food?.find((entry) => entry.tick === mine.tick);
  if (!theirs) return undefined;
  const held = new Set(mine.ids);
  const truth = new Set(theirs.ids);
  let differ = 0;
  for (const id of held) if (!truth.has(id)) differ++;
  for (const id of truth) if (!held.has(id)) differ++;
  return differ;
}
