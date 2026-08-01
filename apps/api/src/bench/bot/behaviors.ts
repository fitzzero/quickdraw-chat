/**
 * Seeded movement behaviors for bench bots. Deterministic given the rng:
 * behavior state only depends on elapsed sim time and the bot's own
 * (predicted) pose, so input streams are approximately reproducible across
 * runs of the same scenario seed.
 */

import type { BehaviorKind } from "@project/bench";
import type { Rng } from "@project/bench";

export interface BehaviorCtx {
  /** seconds since the bot spawned */
  tSec: number;
  selfX: number;
  selfY: number;
  dirX: number;
  dirY: number;
  bounds: { w: number; h: number };
}

export type BehaviorFn = (ctx: BehaviorCtx) => { dx: number; dy: number; boost: boolean };

const WALL_MARGIN = 200;

/** Steer inward when close to a wall; returns null when comfortably inside. */
function wallAvoidance(ctx: BehaviorCtx): { dx: number; dy: number } | null {
  const { selfX, selfY, bounds } = ctx;
  if (
    selfX > WALL_MARGIN &&
    selfY > WALL_MARGIN &&
    selfX < bounds.w - WALL_MARGIN &&
    selfY < bounds.h - WALL_MARGIN
  ) {
    return null;
  }
  return { dx: bounds.w / 2 - selfX, dy: bounds.h / 2 - selfY };
}

/** Heading random-walk: re-roll angular velocity every 1–3s, occasional boosts. */
function makeWander(rng: Rng): BehaviorFn {
  let heading = rng() * Math.PI * 2;
  let angularVel = 0;
  let nextRollAt = 0;
  let boostUntil = -1;
  let lastT = 0;

  return (ctx) => {
    const dt = Math.max(0, ctx.tSec - lastT);
    lastT = ctx.tSec;

    if (ctx.tSec >= nextRollAt) {
      angularVel = (rng() - 0.5) * 2 * 1.5;
      nextRollAt = ctx.tSec + 1 + rng() * 2;
      if (rng() < 0.15) boostUntil = ctx.tSec + 0.5 + rng() * 0.8;
    }
    heading += angularVel * dt;

    const avoid = wallAvoidance(ctx);
    if (avoid) {
      heading = Math.atan2(avoid.dy, avoid.dx);
      angularVel = 0;
    }
    return { dx: Math.cos(heading), dy: Math.sin(heading), boost: ctx.tSec < boostUntil };
  };
}

/**
 * Steer toward a rendezvous point that orbits the world center — all "cross"
 * bots in a scenario share the same orbit, forcing frequent near-misses.
 */
function makeCross(rng: Rng): BehaviorFn {
  const phase = rng() * Math.PI * 2;
  return (ctx) => {
    const cx = ctx.bounds.w / 2;
    const cy = ctx.bounds.h / 2;
    const radius = Math.min(ctx.bounds.w, ctx.bounds.h) * 0.18;
    const angle = ctx.tSec * 0.25;
    const rx = cx + radius * Math.cos(angle);
    const ry = cy + radius * Math.sin(angle);
    // A small per-bot offset keeps them crossing instead of stacking exactly
    const tx = rx + Math.cos(phase) * 60 - ctx.selfX;
    const ty = ry + Math.sin(phase) * 60 - ctx.selfY;
    return { dx: tx, dy: ty, boost: false };
  };
}

/** Fixed circular patrol — maximally predictable control input. */
function makeOrbit(rng: Rng): BehaviorFn {
  const phase = rng() * Math.PI * 2;
  return (ctx) => {
    const cx = ctx.bounds.w / 2;
    const cy = ctx.bounds.h / 2;
    const radius = Math.min(ctx.bounds.w, ctx.bounds.h) * 0.25;
    // Chase a point slightly ahead on the circle
    const angle = phase + ctx.tSec * 0.3 + 0.35;
    const tx = cx + radius * Math.cos(angle) - ctx.selfX;
    const ty = cy + radius * Math.sin(angle) - ctx.selfY;
    return { dx: tx, dy: ty, boost: false };
  };
}

export function makeBehavior(kind: BehaviorKind, rng: Rng): BehaviorFn {
  switch (kind) {
    case "wander":
      return makeWander(rng);
    case "cross":
      return makeCross(rng);
    case "orbit":
      return makeOrbit(rng);
    case "spectator":
      return () => ({ dx: 1, dy: 0, boost: false });
  }
}
