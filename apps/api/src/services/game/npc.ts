/**
 * NPC snakes — population management + utility-scored steering.
 *
 * Lives inside the deterministic sim (driven from GameWorldSim.step through
 * injected closures): all randomness comes from the sim's seeded RNG, so
 * NPC behavior is reproducible in tests. NPCs are ordinary players with
 * namespaced ids — clients render them as remote snakes with zero special
 * casing, and they never persist scores (GameService skips npc- ids).
 */

import type { FoodDTO } from "@project/shared";
import { NPC_ID_PREFIX } from "@project/shared";
import type { BodySample, GameTunables, SnakeState } from "./world.js";

const NPC_NAMES = ["Wormy", "Noodle", "Slinky", "Zigzag", "Doodle", "Wiggles", "Pretzel", "Loops"];

/** Sampled steering offsets around the current heading (radians). */
const CANDIDATE_OFFSETS = [-1.2, -0.6, 0, 0.6, 1.2];

interface NpcState {
  wanderAngle: number;
  /** tick at which a dead NPC revives (0 = alive/unscheduled) */
  respawnAt: number;
  boostTicks: number;
}

export interface NpcControllerDeps {
  tunables: GameTunables;
  rng: () => number;
  getSnake: (id: string) => SnakeState | undefined;
  addPlayer: (id: string, name: string) => void;
  removePlayer: (id: string) => void;
  respawn: (id: string) => void;
  nearestFood: (from: { x: number; y: number }) => FoodDTO | null;
  buildBodyHash: () => Map<string, BodySample[]>;
  probeHitsForeignBody: (
    selfId: string,
    x: number,
    y: number,
    hash: Map<string, BodySample[]>,
  ) => boolean;
}

export class NpcController {
  private readonly deps: NpcControllerDeps;
  private readonly npcs = new Map<string, NpcState>();

  constructor(deps: NpcControllerDeps) {
    this.deps = deps;
  }

  /** Called once per tick, before movement. */
  public update(tick: number): void {
    this.syncPopulation(tick);
    this.steer();
  }

  /**
   * Sync the population to the npcCount tunable (live definition edits apply
   * next tick) and revive dead NPCs after their cooldown.
   */
  private syncPopulation(tick: number): void {
    const want = Math.max(0, Math.floor(this.deps.tunables.npcCount));

    for (const id of [...this.npcs.keys()]) {
      if (Number(id.slice(NPC_ID_PREFIX.length)) >= want) {
        this.deps.removePlayer(id);
        this.npcs.delete(id);
      }
    }

    for (let i = 0; i < want; i++) {
      const id = `${NPC_ID_PREFIX}${i}`;
      if (!this.deps.getSnake(id)) {
        this.deps.addPlayer(id, NPC_NAMES[i % NPC_NAMES.length] ?? "Bot");
        this.npcs.set(id, {
          wanderAngle: this.deps.rng() * Math.PI * 2,
          respawnAt: 0,
          boostTicks: 0,
        });
      }
    }

    for (const [id, state] of this.npcs) {
      const snake = this.deps.getSnake(id);
      if (!snake || snake.alive) {
        state.respawnAt = 0;
        continue;
      }
      if (state.respawnAt === 0) {
        state.respawnAt = tick + Math.max(1, Math.floor(this.deps.tunables.npcRespawnTicks));
      } else if (tick >= state.respawnAt) {
        this.deps.respawn(id);
        state.respawnAt = 0;
      }
    }
  }

  /**
   * Utility-scored steering: sample candidate directions around the current
   * heading, score each by food attraction, danger probes (foreign bodies +
   * walls), straightness, and seeded wander. Writes targetDir/boost directly
   * — NPCs bypass the input seq machinery.
   */
  private steer(): void {
    if (this.npcs.size === 0) return;
    const hash = this.deps.buildBodyHash();

    for (const [id, state] of this.npcs) {
      const snake = this.deps.getSnake(id);
      if (!snake?.alive) continue;

      state.wanderAngle += (this.deps.rng() - 0.5) * 0.6;
      const food = this.deps.nearestFood(snake.head);
      const currentAngle = Math.atan2(snake.dir.y, snake.dir.x);

      let bestScore = -Infinity;
      let bestAngle = currentAngle;
      let bestClear = false;

      for (const offset of CANDIDATE_OFFSETS) {
        const { score, clear } = this.scoreDirection(
          snake,
          currentAngle + offset,
          offset,
          food,
          state,
          hash,
        );
        if (score > bestScore) {
          bestScore = score;
          bestAngle = currentAngle + offset;
          bestClear = clear;
        }
      }

      snake.targetDir = { x: Math.cos(bestAngle), y: Math.sin(bestAngle) };
      this.updateBoost(snake, state, bestClear);
    }
  }

  private scoreDirection(
    snake: SnakeState,
    angle: number,
    offset: number,
    food: FoodDTO | null,
    state: NpcState,
    hash: Map<string, BodySample[]>,
  ): { score: number; clear: boolean } {
    const t = this.deps.tunables;
    // Mild preference for continuing straight
    let score = -Math.abs(offset) * 0.35;

    if (food) {
      const toFood = Math.atan2(food.y - snake.head.y, food.x - snake.head.x);
      let delta = toFood - angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      score += (1 - Math.abs(delta) / Math.PI) * 2;
    }

    score += Math.cos(angle - state.wanderAngle) * 0.4;

    let danger = 0;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    for (const dist of [40, 90]) {
      const px = snake.head.x + dir.x * dist;
      const py = snake.head.y + dir.y * dist;
      const margin = t.headRadius * 3;
      if (px < margin || py < margin || px > t.worldWidth - margin || py > t.worldHeight - margin) {
        danger += 3;
      }
      if (this.deps.probeHitsForeignBody(snake.meta.id, px, py, hash)) {
        danger += 4;
      }
    }

    return { score: score - danger, clear: danger === 0 };
  }

  private updateBoost(snake: SnakeState, state: NpcState, clear: boolean): void {
    if (state.boostTicks > 0) {
      state.boostTicks--;
      snake.boost = clear && state.boostTicks > 0;
      return;
    }
    if (clear && snake.len > this.deps.tunables.minLength + 4 && this.deps.rng() < 0.01) {
      state.boostTicks = 20;
    }
    snake.boost = false;
  }
}
