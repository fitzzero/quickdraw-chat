/**
 * Smoothness metrics — computed on RAW render frames (not the resampled
 * grid) because jitter lives exactly in the frame-to-frame deltas.
 *
 * - Teleports: single-frame displacement beyond what any legal speed could
 *   produce (death/respawn discontinuities are masked via the server record).
 * - Jerk RMS: RMS of frame-to-frame speed change per second — the "does
 *   motion look fluid" number; a snake moving at constant speed with clean
 *   interpolation scores near zero even at high speed.
 * - Corrections/hard snaps: reconciliation events reported by the client.
 */

import type { ClientTrace, ServerTrace, SmoothnessReport } from "../types.js";
import { buildDiscontinuityMask, computeStats } from "./tracks.js";

/** Legal top speed (boost) — used to size the teleport threshold. */
const VMAX_PX_PER_S = 320;
/** Threshold floor so sub-pixel wobble at tiny dt never counts. */
const TELEPORT_FLOOR_PX = 24;
/** Frames further apart than this are a render gap, not a movement sample. */
const MAX_FRAME_GAP_MS = 100;

export function computeSmoothness(
  client: ClientTrace,
  server: ServerTrace,
  windowStart: number,
  windowEnd: number,
): SmoothnessReport {
  const masked = buildDiscontinuityMask(server);
  const minutes = (windowEnd - windowStart) / 60_000;

  let teleports = 0;
  const accelerations: number[] = [];

  // Per-entity previous frame state (pos, time, speed)
  const prev = new Map<string, { t: number; x: number; y: number; speed: number | null }>();

  for (const frame of client.frames) {
    if (frame.tWall < windowStart || frame.tWall > windowEnd) continue;
    for (const [id, pos] of Object.entries(frame.entities)) {
      const p = prev.get(id);
      prev.set(id, { t: frame.tWall, x: pos.x, y: pos.y, speed: null });
      if (!p) continue;
      const dtMs = frame.tWall - p.t;
      if (dtMs <= 0 || dtMs > MAX_FRAME_GAP_MS) continue;
      if (masked(id, frame.tWall)) continue;

      const dist = Math.hypot(pos.x - p.x, pos.y - p.y);
      const dtS = dtMs / 1000;
      if (dist > Math.max(4 * VMAX_PX_PER_S * dtS, TELEPORT_FLOOR_PX)) teleports++;

      const speed = dist / dtS;
      if (p.speed !== null) accelerations.push((speed - p.speed) / dtS);
      const entry = prev.get(id);
      if (entry) entry.speed = speed;
    }
  }

  const corrections = client.corrections.filter(
    (c) => c.tWall >= windowStart && c.tWall <= windowEnd,
  );
  const hardSnaps = corrections.filter((c) => c.hard).length;
  const jerkRms =
    accelerations.length > 0
      ? Math.sqrt(accelerations.reduce((s, a) => s + a * a, 0) / accelerations.length)
      : 0;

  return {
    teleportsPerMin: minutes > 0 ? teleports / minutes : 0,
    jerkRms,
    hardSnapsPerMin: minutes > 0 ? hardSnaps / minutes : 0,
    correctionPx: computeStats(corrections.map((c) => c.magnitudePx)),
  };
}
