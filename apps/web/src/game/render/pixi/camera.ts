/**
 * The camera: a world container scaled and offset so a point of the world
 * lands on the screen (zoom normalizes the apparent
 * world scale to a 720 px tall viewport; the position follows its target
 * with exponential smoothing, speed 8).
 */

import { Container } from "pixi.js";

/** The camera's smoothing speed. */
export const CAMERA_SMOOTHING = 8;
/** The viewport height the world is scaled against. */
export const CAMERA_REFERENCE_HEIGHT = 720;

export class Camera {
  public readonly world = new Container();
  public zoom = 1;
  private x = 0;
  private y = 0;
  private placed = false;

  /** Moves toward `target` (or onto it when `snap`), then lays the world out for a screen of `w` by `h`. */
  public update(
    target: { x: number; y: number },
    snap: boolean,
    deltaS: number,
    w: number,
    h: number,
  ): void {
    if (snap || !this.placed) {
      this.x = target.x;
      this.y = target.y;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-CAMERA_SMOOTHING * deltaS);
      this.x += (target.x - this.x) * k;
      this.y += (target.y - this.y) * k;
    }
    this.zoom = h > 0 ? h / CAMERA_REFERENCE_HEIGHT : 1;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - this.x * this.zoom, h / 2 - this.y * this.zoom);
  }

  /** The world point under a screen point (CSS px from the canvas's corner). */
  public worldPoint(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.world.position.x) / this.zoom,
      y: (sy - this.world.position.y) / this.zoom,
    };
  }
}
