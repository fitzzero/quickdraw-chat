/**
 * Shared snake movement step — the single source of truth for one fixed-dt
 * head/direction/length integration.
 *
 * Extracted verbatim from GameWorldSim.moveSnake (apps/api) so the server
 * sim, headless bench bots, and any TS client prediction all run identical
 * math. The Godot client mirrors this in game_config.gd `sim_step()` — keep
 * all three in lockstep when tuning movement.
 *
 * Pure: no I/O, no randomness, returns a new state.
 */

export interface MovementState {
  /** head position (px) */
  x: number;
  y: number;
  /** current facing, unit vector */
  dirX: number;
  dirY: number;
  /** fractional length in segments */
  len: number;
}

export interface MovementInput {
  /** desired facing, unit vector */
  targetDx: number;
  targetDy: number;
  boost: boolean;
}

/** The subset of GameTunables the movement step needs. */
export interface MovementTunables {
  worldWidth: number;
  worldHeight: number;
  /** px/s */
  baseSpeed: number;
  boostSpeed: number;
  /** rad/s — max turn toward the desired direction */
  turnRate: number;
  minLength: number;
  /** segments burned per second while boosting */
  boostBurnPerSecond: number;
  headRadius: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Advance one snake by one fixed timestep: clamp the turn toward the target
 * direction, burn length while boosting, integrate, clamp to world bounds.
 */
export function stepMovement(
  state: MovementState,
  input: MovementInput,
  t: MovementTunables,
  dt: number,
): MovementState {
  // Turn toward targetDir, clamped by turnRate
  const current = Math.atan2(state.dirY, state.dirX);
  const target = Math.atan2(input.targetDy, input.targetDx);
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxTurn = t.turnRate * dt;
  const angle = current + Math.max(-maxTurn, Math.min(maxTurn, delta));
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  // Boost costs length; below minLength it degrades to normal speed
  const boosting = input.boost && state.len > t.minLength;
  const len = boosting ? Math.max(t.minLength, state.len - t.boostBurnPerSecond * dt) : state.len;
  const speed = boosting ? t.boostSpeed : t.baseSpeed;

  return {
    x: clamp(state.x + dirX * speed * dt, t.headRadius, t.worldWidth - t.headRadius),
    y: clamp(state.y + dirY * speed * dt, t.headRadius, t.worldHeight - t.headRadius),
    dirX,
    dirY,
    len,
  };
}
