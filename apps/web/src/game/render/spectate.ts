/**
 * The spectate camera: before the player joins, and
 * after a death, the camera drifts toward the busiest part of the world so
 * the pre-game dialog sits over live action. Engine-neutral: the shell
 * advances it and hands the renderer its position as the camera target.
 */

/** How fast the camera pans toward its target (per second). */
export const SPECTATE_PAN_SPEED = 1.2;
/** Stickiness toward the current focus snake, so the camera commits to a subject. */
export const SPECTATE_FOCUS_BONUS = 1.35;

interface Point {
  x: number;
  y: number;
}

export class SpectateCamera {
  public readonly position: Point = { x: 0, y: 0 };
  private readonly target: Point = { x: 0, y: 0 };
  private focusId = "";
  private center: Point = { x: 0, y: 0 };

  /** The world's center: the target when nobody is in it. */
  public setBounds(w: number, h: number): void {
    this.center = { x: w / 2, y: h / 2 };
    if (this.focusId === "") {
      this.target.x = this.center.x;
      this.target.y = this.center.y;
    }
  }

  /** Puts the camera on its target at once (the first frame). */
  public snap(): void {
    this.position.x = this.target.x;
    this.position.y = this.target.y;
  }

  /**
   * Focus the snake with the most company
   * (a density score), with hysteresis so the camera does not flick between
   * similar clusters.
   */
  public retarget(snakes: ReadonlyMap<string, Point>): void {
    if (snakes.size === 0) {
      this.focusId = "";
      this.target.x = this.center.x;
      this.target.y = this.center.y;
      return;
    }
    const previous = this.focusId;
    let best = -1;
    for (const [id, pos] of snakes) {
      let score = 0;
      for (const other of snakes.values()) {
        score += 1 / (1 + Math.hypot(pos.x - other.x, pos.y - other.y) / 400);
      }
      if (id === previous) score *= SPECTATE_FOCUS_BONUS;
      if (score > best) {
        best = score;
        this.focusId = id;
        this.target.x = pos.x;
        this.target.y = pos.y;
      }
    }
  }

  /** The camera pans toward its target. */
  public advance(deltaS: number): void {
    const k = Math.min(1, deltaS * SPECTATE_PAN_SPEED);
    this.position.x += (this.target.x - this.position.x) * k;
    this.position.y += (this.target.y - this.position.y) * k;
  }
}
