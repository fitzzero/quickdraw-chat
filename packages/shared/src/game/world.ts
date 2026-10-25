/**
 * GameWorldSim — the authoritative snake simulation.
 *
 * Pure and deterministic by construction: no I/O, no Date.now(), all
 * randomness through an injectable seeded RNG, fixed timestep. This is what
 * makes the netcode testable (identical inputs → identical state) and what
 * lets the Godot client run the same movement rules for prediction.
 *
 * Key design choice: only snake HEADS exist on the wire. Each side keeps a
 * per-snake path history of head positions and derives body segments at fixed
 * arc-length spacing along it — the server for collision, clients for
 * rendering. Each player adds 23 bytes to a packed snapshot (31 in its
 * base64, about 110 as JSON), whatever its snake's length.
 *
 * A human snake steps once for each input frame its client sent (InputQueue),
 * one a tick unless a backlog builds: the client predicts one step per frame,
 * so the snapshot's `ack` names the last frame the server's state holds and
 * the client's replay reproduces its position. Once its first frame stepped,
 * a tick without a frame coasts on the last intent, and the ack covers the
 * coast as the client's next frame; that frame, when it arrives, is not
 * stepped but steers the next step (the ack always counts the steps). A
 * tick of several steps checks collisions at every head it passed. NPCs
 * steer in place and step once a tick.
 */

import type {
  FoodDelta,
  FoodDTO,
  GameDeathEvent,
  GameInput,
  GamePlayerMeta,
  LeaderboardEntry,
  PlayerSnap,
  WorldSnapshot,
} from "../types/game.js";
import { GAME_TICK_RATE, NPC_ID_PREFIX } from "../types/game.js";
import { stepMovement } from "./movement.js";
import { InputQueue } from "./inputQueue.js";
import { NpcController } from "./npc.js";

export interface GameTunables {
  worldWidth: number;
  worldHeight: number;
  /** px/s */
  baseSpeed: number;
  boostSpeed: number;
  /** rad/s — max turn toward the desired direction */
  turnRate: number;
  /** starting length in segments */
  startLength: number;
  minLength: number;
  /** segments burned per second while boosting */
  boostBurnPerSecond: number;
  /** px between rendered segments (defines how much path a snake needs) */
  segmentSpacing: number;
  /** px between stored path samples (collision + render resolution) */
  sampleSpacing: number;
  headRadius: number;
  bodyRadius: number;
  /** pickup radius around food */
  foodRadius: number;
  maxFood: number;
  initialFood: number;
  /** ticks between food spawns */
  foodSpawnIntervalTicks: number;
  /** drop one food per N path samples when a snake dies */
  deathFoodEvery: number;
  /** AI snakes kept alive in the world (0 disables) */
  npcCount: number;
  /** ticks before a dead NPC respawns */
  npcRespawnTicks: number;
}

/** The most food (maxFood, initialFood) and NPCs a world holds: a packed snapshot's 16-bit counts. */
export const COUNT_TUNABLE_MAX = 0xffff;
const COUNT_TUNABLES: ReadonlySet<keyof GameTunables> = new Set([
  "maxFood",
  "initialFood",
  "npcCount",
]);

export const DEFAULT_TUNABLES: GameTunables = {
  worldWidth: 2400,
  worldHeight: 2400,
  baseSpeed: 180,
  boostSpeed: 320,
  turnRate: 4,
  startLength: 10,
  minLength: 5,
  boostBurnPerSecond: 1.5,
  segmentSpacing: 16,
  sampleSpacing: 8,
  headRadius: 10,
  bodyRadius: 9,
  foodRadius: 14,
  maxFood: 150,
  initialFood: 60,
  foodSpawnIntervalTicks: 10,
  deathFoodEvery: 4,
  npcCount: 4,
  npcRespawnTicks: 60,
};

export function isNpcId(id: string): boolean {
  return id.startsWith(NPC_ID_PREFIX);
}

interface Vec {
  x: number;
  y: number;
}

export interface SnakeState {
  meta: GamePlayerMeta;
  alive: boolean;
  head: Vec;
  dir: Vec;
  targetDir: Vec;
  boost: boolean;
  /** fractional — floor() is the displayed segment count */
  len: number;
  /** head-position history, oldest → newest (head is the last sample) */
  path: Vec[];
  /** the client's frames waiting to be stepped (humans; NPCs steer in place) */
  inputs: InputQueue;
  /** the seq of the newest frame whose intent steers the snake, stepped or adopted late */
  steeredSeq: number;
  /** stepped a frame since it spawned: until then no client has stepped it either */
  fed: boolean;
  /** heads it passed this tick before its last step (a tick of several): collisions check them too */
  swept: Vec[];
}

interface FoodState extends FoodDTO {}

export interface BodySample {
  owner: string;
  x: number;
  y: number;
}

/** One human snake's input accounting for a tick. */
export interface TickInputs {
  /**
   * frames stepped this tick (0: none had arrived, the snake coasted on its
   * last intent, standing in for the client's next frame)
   */
  stepped: number;
  /** frames still queued after the take */
  depth: number;
}

export interface TickResult {
  /** The tick's snapshot; the loop adds the food changes of the last ticks (`food`). */
  snapshot: WorldSnapshot;
  /** The food this tick changed (none: null). */
  food: FoodDelta | null;
  deaths: GameDeathEvent[];
  /**
   * Per human snake alive and fed this tick: what the server sees of its
   * client's clock (the bench records it). Never on the wire.
   */
  inputs: Record<string, TickInputs>;
}

/** Deterministic PRNG (mulberry32) so tests and replays are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPATIAL_CELL = 64;

const f32 = new Float32Array(1);
const f32Bits = new Uint32Array(f32.buffer);

/** The float32 next to a positive float32 `x`, above or below it. */
function float32Beside(x: number, up: boolean): number {
  f32[0] = x;
  f32Bits[0] = (f32Bits[0] ?? 0) + (up ? 1 : -1);
  return f32[0];
}

/**
 * A snake's length as the packed snapshot carries it (a float32), on the
 * same side of `minLength` as the sim's: the client's prediction decides
 * boost by `len > minLength` from it as the server does, where a plain
 * rounding could flip it (a length a float error leaves just above the
 * minimum, or a minimum float32 cannot hold, such as 5.3).
 */
function wireLength(len: number, minLength: number): number {
  const wire = Math.fround(len);
  if (!(wire > 0)) return wire;
  // the nearest float32 and the one beside it hold `len` between them
  if (len > minLength && wire <= minLength) return float32Beside(wire, true);
  if (len <= minLength && wire > minLength) return float32Beside(wire, false);
  return wire;
}

export class GameWorldSim {
  public readonly tunables: GameTunables;
  public readonly dt = 1 / GAME_TICK_RATE;
  public tick = 0;

  private readonly players = new Map<string, SnakeState>();
  private readonly food = new Map<string, FoodState>();
  private npcController: NpcController | null = null;
  private readonly rng: () => number;
  private nextFoodId = 1;
  private ticksSinceFoodSpawn = 0;

  constructor(options?: { tunables?: Partial<GameTunables>; seed?: number }) {
    this.tunables = { ...DEFAULT_TUNABLES };
    if (options?.tunables) this.applyTunables(options.tunables);
    this.rng = mulberry32(options?.seed ?? 1);

    for (let i = 0; i < this.tunables.initialFood; i++) {
      this.spawnFood();
    }
  }

  /**
   * Apply tunable overrides (boot config or a live DefinitionService edit).
   * Only known keys with finite numeric values are accepted — definitions
   * are admin-edited JSON, so treat them as untrusted. The counts of food
   * and NPCs stay within COUNT_TUNABLE_MAX: a packed snapshot counts food
   * and players in 16 bits, and a seed carries all the food in one entry.
   *
   * Note for live edits: connected Godot clients keep predicting with the
   * values they fetched at load, so movement tunables cause reconciliation
   * drift until players reload. Server-authoritative correction absorbs it.
   */
  public applyTunables(partial: Partial<GameTunables>): void {
    for (const key of Object.keys(DEFAULT_TUNABLES) as (keyof GameTunables)[]) {
      const value = partial[key];
      // Non-negative finite numbers only (zero is legitimate, e.g. initialFood)
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        this.tunables[key] = COUNT_TUNABLES.has(key) ? Math.min(value, COUNT_TUNABLE_MAX) : value;
      }
    }
  }

  // ==========================================================================
  // Players
  // ==========================================================================

  /** Add (or revive-on-rejoin) a player. Returns meta + whether they're new. */
  public addPlayer(id: string, name: string | null): { meta: GamePlayerMeta; isNew: boolean } {
    const existing = this.players.get(id);
    if (existing) {
      if (!existing.alive) this.spawnSnake(existing);
      return { meta: existing.meta, isNew: false };
    }

    const meta: GamePlayerMeta = { id, name, hue: Math.floor(this.rng() * 360) };
    const snake: SnakeState = {
      meta,
      alive: false,
      head: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      targetDir: { x: 1, y: 0 },
      boost: false,
      len: this.tunables.startLength,
      path: [],
      inputs: new InputQueue(),
      steeredSeq: 0,
      fed: false,
      swept: [],
    };
    this.spawnSnake(snake);
    this.players.set(id, snake);
    return { meta, isNew: true };
  }

  public removePlayer(id: string): boolean {
    return this.players.delete(id);
  }

  public respawn(id: string): boolean {
    const snake = this.players.get(id);
    if (!snake || snake.alive) return false;
    this.spawnSnake(snake);
    return true;
  }

  public hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  public isAlive(id: string): boolean {
    return this.players.get(id)?.alive ?? false;
  }

  public playerCount(): number {
    return this.players.size;
  }

  /** Real players only — NPCs don't count toward "is anyone here". */
  public humanCount(): number {
    let count = 0;
    for (const id of this.players.keys()) {
      if (!isNpcId(id)) count++;
    }
    return count;
  }

  private spawnSnake(snake: SnakeState): void {
    const { worldWidth, worldHeight, startLength } = this.tunables;
    // Spawn away from the walls
    snake.head = {
      x: worldWidth * (0.2 + this.rng() * 0.6),
      y: worldHeight * (0.2 + this.rng() * 0.6),
    };
    const angle = this.rng() * Math.PI * 2;
    snake.dir = { x: Math.cos(angle), y: Math.sin(angle) };
    snake.targetDir = { ...snake.dir };
    snake.len = startLength;
    snake.boost = false;
    snake.path = [{ ...snake.head }];
    snake.alive = true;
    // What was queued for the old snake is not for this one; its client starts
    // again from the snapshot's ack, which the queue keeps
    snake.inputs.clear();
    snake.fed = false;
  }

  // ==========================================================================
  // Input
  // ==========================================================================

  /**
   * Queues a client's frames (a message carries its newest last and up to
   * three before it). The ticks that follow step them in seq order, one a
   * tick; a frame queued already is ignored, as is everything for a dead
   * snake. A frame for a seq the snake's state already holds (a coast stood
   * in for it) is not stepped, but when it is newer than the frame the
   * snake last steered by, its intent is adopted now, so the next coast or
   * step moves on it: a client whose frames keep landing just after the
   * tick is steered one tick behind its prediction, never a step behind it.
   */
  public queueInputs(id: string, frames: readonly GameInput[]): void {
    const snake = this.players.get(id);
    if (!snake || !snake.alive || isNpcId(id)) return;
    for (const frame of frames) {
      if (snake.inputs.push(frame)) continue;
      if (frame.seq > snake.steeredSeq && frame.seq <= snake.inputs.lastSeq) {
        this.steer(snake, frame);
        snake.steeredSeq = frame.seq;
      }
    }
  }

  /** A frame's intent: its direction (when it has one) and its boost. */
  private steer(snake: SnakeState, frame: GameInput): void {
    const mag = Math.hypot(frame.dx, frame.dy);
    if (Number.isFinite(mag) && mag > 1e-6) {
      snake.targetDir = { x: frame.dx / mag, y: frame.dy / mag };
    }
    snake.boost = frame.boost;
  }

  // ==========================================================================
  // Simulation step
  // ==========================================================================

  public step(): TickResult {
    this.tick++;
    const foodEaten: string[] = [];
    const foodSpawned: FoodDTO[] = [];
    const deaths: GameDeathEvent[] = [];
    const inputs: Record<string, TickInputs> = {};

    this.npcs().update(this.tick);

    for (const snake of this.players.values()) {
      if (!snake.alive) continue;
      if (isNpcId(snake.meta.id)) {
        // The controller set its intent: one step a tick
        this.moveSnake(snake);
        this.eatNearbyFood(snake, foodEaten);
        continue;
      }
      // One step per frame its client sent, one frame a tick; once it has
      // sent its first, a tick without one coasts on the last intent, and
      // the queue counts the coast as the client's next frame
      const frames = snake.inputs.take(this.dt);
      snake.swept.length = 0;
      for (const [i, frame] of frames.entries()) {
        if (i > 0) snake.swept.push({ ...snake.head });
        this.steer(snake, frame);
        snake.steeredSeq = Math.max(snake.steeredSeq, frame.seq);
        this.moveSnake(snake);
        this.eatNearbyFood(snake, foodEaten);
      }
      if (frames.length > 0) {
        snake.fed = true;
      } else if (snake.fed) {
        this.moveSnake(snake);
        this.eatNearbyFood(snake, foodEaten);
        snake.inputs.coast();
      }
      if (snake.fed) {
        inputs[snake.meta.id] = { stepped: frames.length, depth: snake.inputs.depth() };
      }
    }

    this.resolveCollisions(deaths, foodSpawned);
    this.respawnFood(foodSpawned);

    const changed = foodSpawned.length > 0 || foodEaten.length > 0;
    return {
      snapshot: { tick: this.tick, players: this.buildSnaps() },
      food: changed
        ? {
            tick: this.tick,
            ...(foodSpawned.length > 0 ? { spawned: foodSpawned } : {}),
            ...(foodEaten.length > 0 ? { eaten: foodEaten } : {}),
          }
        : null,
      deaths,
      inputs,
    };
  }

  /** Lazily constructed so the controller sees post-applyTunables values. */
  private npcs(): NpcController {
    this.npcController ??= new NpcController({
      tunables: this.tunables,
      rng: this.rng,
      getSnake: (id): SnakeState | undefined => this.players.get(id),
      addPlayer: (id, name): void => void this.addPlayer(id, name),
      removePlayer: (id): void => void this.players.delete(id),
      respawn: (id): void => void this.respawn(id),
      nearestFood: (from): FoodDTO | null => this.nearestFood(from),
      buildBodyHash: (): Map<string, BodySample[]> => this.buildBodyHash(),
      probeHitsForeignBody: (selfId, x, y, hash): boolean =>
        this.probeHitsForeignBody(selfId, x, y, hash),
    });
    return this.npcController;
  }

  private nearestFood(from: Vec): FoodDTO | null {
    let best: FoodDTO | null = null;
    let bestDist = Infinity;
    for (const item of this.food.values()) {
      const dist = Math.hypot(item.x - from.x, item.y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return best;
  }

  private probeHitsForeignBody(
    selfId: string,
    x: number,
    y: number,
    hash: Map<string, BodySample[]>,
  ): boolean {
    const reach = this.tunables.headRadius + this.tunables.bodyRadius + 6;
    const cx = Math.floor(x / SPATIAL_CELL);
    const cy = Math.floor(y / SPATIAL_CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const cell = hash.get(`${ix},${iy}`);
        if (!cell) continue;
        if (cell.some((s) => s.owner !== selfId && Math.hypot(s.x - x, s.y - y) <= reach)) {
          return true;
        }
      }
    }
    return false;
  }

  private moveSnake(snake: SnakeState): void {
    const t = this.tunables;

    const next = stepMovement(
      { x: snake.head.x, y: snake.head.y, dirX: snake.dir.x, dirY: snake.dir.y, len: snake.len },
      { targetDx: snake.targetDir.x, targetDy: snake.targetDir.y, boost: snake.boost },
      t,
      this.dt,
    );
    snake.dir = { x: next.dirX, y: next.dirY };
    snake.len = next.len;
    snake.head = { x: next.x, y: next.y };

    // Record path samples at fixed spacing; trim to the arc length the body needs
    const last = snake.path.at(-1) ?? snake.head;
    if (Math.hypot(snake.head.x - last.x, snake.head.y - last.y) >= t.sampleSpacing) {
      snake.path.push({ ...snake.head });
      const maxSamples = Math.ceil((snake.len * t.segmentSpacing) / t.sampleSpacing) + 4;
      while (snake.path.length > maxSamples) snake.path.shift();
    }
  }

  private eatNearbyFood(snake: SnakeState, foodEaten: string[]): void {
    const t = this.tunables;
    const eatDist = t.headRadius + t.foodRadius;
    for (const item of this.food.values()) {
      if (Math.hypot(item.x - snake.head.x, item.y - snake.head.y) <= eatDist) {
        snake.len += item.v;
        this.food.delete(item.id);
        foodEaten.push(item.id);
      }
    }
  }

  /**
   * Head-vs-foreign-body collision via a spatial hash of path samples, at the
   * head and at every head a tick of several steps passed (so a catch-up
   * cannot step over a body), against the bodies as they stand at the end
   * of the tick. Self-collision is intentionally off (slither.io rules —
   * crossing your own body is allowed; only foreign bodies kill).
   */
  private resolveCollisions(deaths: GameDeathEvent[], foodSpawned: FoodDTO[]): void {
    const hash = this.buildBodyHash();
    const dying: SnakeState[] = [];

    for (const snake of this.players.values()) {
      if (!snake.alive) continue;
      const hit =
        this.hitsForeignBody(snake, snake.head, hash) ||
        snake.swept.some((head) => this.hitsForeignBody(snake, head, hash));
      if (hit) dying.push(snake);
    }

    for (const snake of dying) {
      snake.alive = false;
      deaths.push({ id: snake.meta.id, len: Math.floor(snake.len) });
      this.dropDeathFood(snake, foodSpawned);
    }
  }

  private buildBodyHash(): Map<string, BodySample[]> {
    const hash = new Map<string, BodySample[]>();
    for (const snake of this.players.values()) {
      if (!snake.alive) continue;
      for (const p of snake.path) {
        const key = `${Math.floor(p.x / SPATIAL_CELL)},${Math.floor(p.y / SPATIAL_CELL)}`;
        let cell = hash.get(key);
        if (!cell) hash.set(key, (cell = []));
        cell.push({ owner: snake.meta.id, x: p.x, y: p.y });
      }
    }
    return hash;
  }

  private hitsForeignBody(snake: SnakeState, head: Vec, hash: Map<string, BodySample[]>): boolean {
    const killDist = this.tunables.headRadius + this.tunables.bodyRadius;
    const cx = Math.floor(head.x / SPATIAL_CELL);
    const cy = Math.floor(head.y / SPATIAL_CELL);

    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const cell = hash.get(`${ix},${iy}`);
        if (!cell) continue;
        const hit = cell.some(
          (s) => s.owner !== snake.meta.id && Math.hypot(s.x - head.x, s.y - head.y) <= killDist,
        );
        if (hit) return true;
      }
    }
    return false;
  }

  /** Body converts to food (capped so a huge snake doesn't flood the world). */
  private dropDeathFood(snake: SnakeState, foodSpawned: FoodDTO[]): void {
    for (let i = 0; i < snake.path.length; i += this.tunables.deathFoodEvery) {
      if (this.food.size >= this.tunables.maxFood) break;
      const p = snake.path[i];
      if (!p) continue;
      foodSpawned.push(this.spawnFood({ x: p.x, y: p.y, v: 2 }));
    }
  }

  private respawnFood(foodSpawned: FoodDTO[]): void {
    this.ticksSinceFoodSpawn++;
    if (
      this.ticksSinceFoodSpawn >= this.tunables.foodSpawnIntervalTicks &&
      this.food.size < this.tunables.maxFood
    ) {
      this.ticksSinceFoodSpawn = 0;
      foodSpawned.push(this.spawnFood());
    }
  }

  private spawnFood(at?: { x: number; y: number; v: number }): FoodDTO {
    const t = this.tunables;
    const item: FoodState = {
      id: `f${this.nextFoodId++}`,
      x: at?.x ?? t.foodRadius + this.rng() * (t.worldWidth - t.foodRadius * 2),
      y: at?.y ?? t.foodRadius + this.rng() * (t.worldHeight - t.foodRadius * 2),
      v: at?.v ?? 1,
    };
    this.food.set(item.id, item);
    return { ...item };
  }

  // ==========================================================================
  // Snapshots & bootstrap
  // ==========================================================================

  private buildSnaps(): PlayerSnap[] {
    const snaps: PlayerSnap[] = [];
    for (const snake of this.players.values()) {
      if (!snake.alive) continue;
      snaps.push({
        id: snake.meta.id,
        x: Math.round(snake.head.x * 10) / 10,
        y: Math.round(snake.head.y * 10) / 10,
        dx: Math.round(snake.dir.x * 1000) / 1000,
        dy: Math.round(snake.dir.y * 1000) / 1000,
        len: wireLength(snake.len, this.tunables.minLength),
        boost: snake.boost && snake.len > this.tunables.minLength,
        ack: snake.inputs.lastSeq,
      });
    }
    return snaps;
  }

  public getBootstrapState(): {
    players: GamePlayerMeta[];
    snaps: PlayerSnap[];
    food: FoodDTO[];
  } {
    return {
      players: Array.from(this.players.values()).map((s) => s.meta),
      snaps: this.buildSnaps(),
      food: Array.from(this.food.values()).map((f) => ({ ...f })),
    };
  }

  /**
   * The world now as one snapshot (a keyframe): every snake's head and all
   * the food in one entry at this tick, which replaces a client's food. The
   * world stream's seed: the snapshots that follow change it.
   */
  public keyframe(): WorldSnapshot {
    return {
      tick: this.tick,
      players: this.buildSnaps(),
      food: [{ tick: this.tick, spawned: Array.from(this.food.values()).map((f) => ({ ...f })) }],
    };
  }

  public leaderboard(limit = 10): LeaderboardEntry[] {
    return Array.from(this.players.values())
      .filter((s) => s.alive)
      .sort((a, b) => b.len - a.len)
      .slice(0, limit)
      .map((s) => ({ id: s.meta.id, name: s.meta.name, len: Math.floor(s.len) }));
  }

  /** Test/debug helper: current head position of a player. */
  public getHead(id: string): { x: number; y: number } | null {
    const snake = this.players.get(id);
    return snake ? { ...snake.head } : null;
  }

  /** Test/debug helper: current length (fractional). */
  public getLength(id: string): number | null {
    return this.players.get(id)?.len ?? null;
  }
}
