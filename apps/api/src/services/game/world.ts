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
 * rendering. Snapshots stay ~35 bytes/player regardless of snake length.
 */

import type {
  FoodDTO,
  GameDeathEvent,
  GameInput,
  GamePlayerMeta,
  LeaderboardEntry,
  PlayerSnap,
  WorldSnapshot,
} from "@project/shared";
import { GAME_TICK_RATE } from "@project/shared";

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
}

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
};

interface Vec {
  x: number;
  y: number;
}

interface SnakeState {
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
  lastSeq: number;
}

interface FoodState extends FoodDTO {}

interface BodySample {
  owner: string;
  x: number;
  y: number;
}

export interface TickResult {
  snapshot: WorldSnapshot;
  deaths: GameDeathEvent[];
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

export class GameWorldSim {
  public readonly tunables: GameTunables;
  public readonly dt = 1 / GAME_TICK_RATE;
  public tick = 0;

  private readonly players = new Map<string, SnakeState>();
  private readonly food = new Map<string, FoodState>();
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
   * are admin-edited JSON, so treat them as untrusted.
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
        this.tunables[key] = value;
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
      lastSeq: 0,
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
  }

  // ==========================================================================
  // Input
  // ==========================================================================

  public applyInput(id: string, input: GameInput): void {
    const snake = this.players.get(id);
    if (!snake || !snake.alive) return;
    // Latest-wins by sequence number; stale/replayed frames are ignored
    if (input.seq <= snake.lastSeq) return;

    const mag = Math.hypot(input.dx, input.dy);
    if (Number.isFinite(mag) && mag > 1e-6) {
      snake.targetDir = { x: input.dx / mag, y: input.dy / mag };
    }
    snake.boost = input.boost;
    snake.lastSeq = input.seq;
  }

  // ==========================================================================
  // Simulation step
  // ==========================================================================

  public step(): TickResult {
    this.tick++;
    const foodEaten: string[] = [];
    const foodSpawned: FoodDTO[] = [];
    const deaths: GameDeathEvent[] = [];

    for (const snake of this.players.values()) {
      if (!snake.alive) continue;
      this.moveSnake(snake);
      this.eatNearbyFood(snake, foodEaten);
    }

    this.resolveCollisions(deaths, foodSpawned);
    this.respawnFood(foodSpawned);

    return {
      snapshot: {
        tick: this.tick,
        players: this.buildSnaps(),
        ...(foodSpawned.length > 0 ? { foodSpawned } : {}),
        ...(foodEaten.length > 0 ? { foodEaten } : {}),
      },
      deaths,
    };
  }

  private moveSnake(snake: SnakeState): void {
    const t = this.tunables;

    // Turn toward targetDir, clamped by turnRate
    const current = Math.atan2(snake.dir.y, snake.dir.x);
    const target = Math.atan2(snake.targetDir.y, snake.targetDir.x);
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = t.turnRate * this.dt;
    const angle = current + Math.max(-maxTurn, Math.min(maxTurn, delta));
    snake.dir = { x: Math.cos(angle), y: Math.sin(angle) };

    // Boost costs length; below minLength it degrades to normal speed
    const boosting = snake.boost && snake.len > t.minLength;
    if (boosting) {
      snake.len = Math.max(t.minLength, snake.len - t.boostBurnPerSecond * this.dt);
    }
    const speed = boosting ? t.boostSpeed : t.baseSpeed;

    snake.head = {
      x: this.clamp(
        snake.head.x + snake.dir.x * speed * this.dt,
        t.headRadius,
        t.worldWidth - t.headRadius,
      ),
      y: this.clamp(
        snake.head.y + snake.dir.y * speed * this.dt,
        t.headRadius,
        t.worldHeight - t.headRadius,
      ),
    };

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
   * Head-vs-foreign-body collision via a spatial hash of path samples.
   * Self-collision is intentionally off (slither.io rules — crossing your own
   * body is allowed; only foreign bodies kill).
   */
  private resolveCollisions(deaths: GameDeathEvent[], foodSpawned: FoodDTO[]): void {
    const hash = this.buildBodyHash();
    const dying: SnakeState[] = [];

    for (const snake of this.players.values()) {
      if (snake.alive && this.headHitsForeignBody(snake, hash)) {
        dying.push(snake);
      }
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

  private headHitsForeignBody(snake: SnakeState, hash: Map<string, BodySample[]>): boolean {
    const killDist = this.tunables.headRadius + this.tunables.bodyRadius;
    const cx = Math.floor(snake.head.x / SPATIAL_CELL);
    const cy = Math.floor(snake.head.y / SPATIAL_CELL);

    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const cell = hash.get(`${ix},${iy}`);
        if (!cell) continue;
        const hit = cell.some(
          (s) =>
            s.owner !== snake.meta.id &&
            Math.hypot(s.x - snake.head.x, s.y - snake.head.y) <= killDist,
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
        len: Math.floor(snake.len),
        boost: snake.boost && snake.len > this.tunables.minLength,
        ack: snake.lastSeq,
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

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
}
