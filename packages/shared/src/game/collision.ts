/**
 * Collision geometry for the sim (./world.ts): a spatial hash of every live
 * snake's path samples and true head, the front-arc rule that finds the
 * sample that kills a head, and the NPCs' look-ahead over the same hash.
 *
 * Pure: no I/O, no randomness.
 */

import type { SnakeState } from "./world.js";

/** A sample of a snake's path, or its true head, by its owner. */
export interface BodySample {
  owner: string;
  x: number;
  y: number;
  /** the owner's true head, not a sample of its path */
  head: boolean;
}

/** Every live snake's samples, by spatial cell. */
export type BodyHash = Map<string, BodySample[]>;

/** A head where it stood, with the heading it had there (a unit vector). */
export interface PassedHead {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
}

/** px: a hash cell's side; a lookup reads the 3x3 cells around a point, so a reach stays within one */
const SPATIAL_CELL = 64;

/** px: float slack on the front arc's edge, which counts as inside (at 180 degrees, beside the head) */
const ARC_SLACK = 1e-9;

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** A snake's head now, with its heading. */
export function headOf(snake: SnakeState): PassedHead {
  return { x: snake.head.x, y: snake.head.y, dirX: snake.dir.x, dirY: snake.dir.y };
}

/**
 * Every live snake's path samples by spatial cell, and its true head,
 * flagged: a path's last sample may lie up to a sample spacing behind the
 * head, and head contact is judged where the heads are.
 */
export function buildBodyHash(snakes: Iterable<SnakeState>): BodyHash {
  const hash: BodyHash = new Map();
  const add = (sample: BodySample): void => {
    const key = cellKey(Math.floor(sample.x / SPATIAL_CELL), Math.floor(sample.y / SPATIAL_CELL));
    let cell = hash.get(key);
    if (!cell) hash.set(key, (cell = []));
    cell.push(sample);
  };
  for (const snake of snakes) {
    if (!snake.alive) continue;
    for (const p of snake.path) add({ owner: snake.meta.id, x: p.x, y: p.y, head: false });
    add({ owner: snake.meta.id, x: snake.head.x, y: snake.head.y, head: true });
  }
  return hash;
}

/**
 * The sample of another snake than `selfId` that kills a head at `at`: the
 * nearest within `reach` whose direction from the head lies within half
 * the front arc of its heading (`cosHalfArc`, the cosine of half the arc),
 * a true head before the path sample under it; null when none does. A
 * sample behind the arc leaves the head alive: the other snake's front met
 * this one's back.
 */
export function killingSample(
  hash: BodyHash,
  selfId: string,
  at: PassedHead,
  reach: number,
  cosHalfArc: number,
): BodySample | null {
  const cx = Math.floor(at.x / SPATIAL_CELL);
  const cy = Math.floor(at.y / SPATIAL_CELL);
  const reachSq = reach * reach;
  let nearest: BodySample | null = null;
  let nearestDist = Infinity;

  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const cell = hash.get(cellKey(ix, iy));
      if (!cell) continue;
      for (const s of cell) {
        // self-collision is off (and its own body fills the cells around its head)
        if (s.owner === selfId) continue;
        const dx = s.x - at.x;
        const dy = s.y - at.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > reachSq) continue;
        const dist = Math.sqrt(distSq);
        // the angle between the sample's direction and the heading is within half the arc
        if (dx * at.dirX + dy * at.dirY < dist * cosHalfArc - ARC_SLACK) continue;
        if (dist < nearestDist || (dist === nearestDist && s.head)) {
          nearest = s;
          nearestDist = dist;
        }
      }
    }
  }
  return nearest;
}

/** Whether a sample of another snake than `selfId` lies within `reach` of (x, y), in any direction. */
export function foreignSampleWithin(
  hash: BodyHash,
  selfId: string,
  x: number,
  y: number,
  reach: number,
): boolean {
  const cx = Math.floor(x / SPATIAL_CELL);
  const cy = Math.floor(y / SPATIAL_CELL);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const cell = hash.get(cellKey(ix, iy));
      if (!cell) continue;
      if (cell.some((s) => s.owner !== selfId && Math.hypot(s.x - x, s.y - y) <= reach)) {
        return true;
      }
    }
  }
  return false;
}
