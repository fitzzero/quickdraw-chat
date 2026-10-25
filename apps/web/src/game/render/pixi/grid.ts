/**
 * The world's border and its grid, built once per change of
 * the bounds into one Graphics and never touched again: the one place in
 * the renderer that builds geometry after mount.
 */

import { Graphics } from "pixi.js";

/** The grid cell, px. */
export const GRID_CELL = 120;

export class Grid {
  public readonly view = new Graphics();

  constructor(private readonly countBuild: () => void) {}

  public setBounds(w: number, h: number): void {
    const g = this.view;
    g.clear();
    g.rect(0, 0, w, h).stroke({ width: 3, color: 0xffffff, alpha: 0.15 });
    for (let x = 0; x <= w; x += GRID_CELL) g.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += GRID_CELL) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.04 });
    this.countBuild();
  }
}
