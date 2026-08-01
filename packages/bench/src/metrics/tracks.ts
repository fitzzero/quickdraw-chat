/**
 * Track utilities — turn raw traces into time-indexed per-entity position
 * tracks that can be sampled at arbitrary wall times, plus the validity
 * masking that keeps legitimate discontinuities (death, respawn, join) out
 * of the desync/smoothness numbers.
 */

import type { ClientTrace, ServerTrace, Stats } from "../types.js";

export interface Track {
  t: number[];
  x: number[];
  y: number[];
}

/** Max ms between bracketing samples for an interpolated read to count. */
export const MAX_SAMPLE_GAP_MS = 100;
/** Mask window around a death/appearance (asymmetric: interp delay renders late). */
export const MASK_BEFORE_MS = 250;
export const MASK_AFTER_MS = 700;
/** Metric grid frequency. */
export const GRID_HZ = 60;

export function computeStats(values: number[]): Stats {
  if (values.length === 0) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function buildClientTracks(trace: ClientTrace): Map<string, Track> {
  const tracks = new Map<string, Track>();
  for (const frame of trace.frames) {
    for (const [id, pos] of Object.entries(frame.entities)) {
      let track = tracks.get(id);
      if (!track) tracks.set(id, (track = { t: [], x: [], y: [] }));
      track.t.push(frame.tWall);
      track.x.push(pos.x);
      track.y.push(pos.y);
    }
  }
  return tracks;
}

export function buildServerTracks(trace: ServerTrace): Map<string, Track> {
  const tracks = new Map<string, Track>();
  for (const tick of trace.ticks) {
    for (const p of tick.players) {
      let track = tracks.get(p.id);
      if (!track) tracks.set(p.id, (track = { t: [], x: [], y: [] }));
      track.t.push(tick.tWall);
      track.x.push(p.x);
      track.y.push(p.y);
    }
  }
  return tracks;
}

/**
 * Linear-interpolated read at wall time `t`, or null when out of range or
 * the bracketing samples are further apart than `maxGapMs` (entity absent).
 */
/** Last index with t[i] <= t (track times are sorted ascending). */
function lowerBound(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((times[mid] ?? Infinity) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

export function sampleTrack(
  track: Track,
  t: number,
  maxGapMs = MAX_SAMPLE_GAP_MS,
): { x: number; y: number } | null {
  const n = track.t.length;
  const first = track.t[0];
  const last = track.t[n - 1];
  if (n < 2 || first === undefined || last === undefined || t < first || t > last) return null;

  const i = Math.min(lowerBound(track.t, t), n - 2);
  const t0 = track.t[i] ?? 0;
  const t1 = track.t[i + 1] ?? 0;
  if (t1 - t0 > maxGapMs) return null;
  const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return {
    x: lerp(track.x[i] ?? 0, track.x[i + 1] ?? 0, alpha),
    y: lerp(track.y[i] ?? 0, track.y[i + 1] ?? 0, alpha),
  };
}

/**
 * Per-entity discontinuity mask: true when `t` falls near a death or a
 * (re)appearance of the entity in the authoritative record.
 */
export function buildDiscontinuityMask(server: ServerTrace): (id: string, t: number) => boolean {
  const events = new Map<string, number[]>();
  const push = (id: string, t: number) => {
    let list = events.get(id);
    if (!list) events.set(id, (list = []));
    list.push(t);
  };

  for (const death of server.deaths) push(death.id, death.tWall);

  let previous = new Set<string>();
  for (const tick of server.ticks) {
    const current = new Set<string>();
    for (const p of tick.players) {
      current.add(p.id);
      // First tick an id is present after absence = appearance/respawn
      if (!previous.has(p.id)) push(p.id, tick.tWall);
    }
    previous = current;
  }

  return (id, t) => {
    const list = events.get(id);
    if (!list) return false;
    return list.some((e) => t >= e - MASK_BEFORE_MS && t <= e + MASK_AFTER_MS);
  };
}
