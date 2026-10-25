/**
 * The player's input (local_snake.gd _step_once and _is_boosting): the
 * snake steers toward the pointer, and boosts while the primary button or
 * Space is held. Sampled by the core once per predicted step, never on the
 * event: a step reads the pointer where it is now.
 */

import type { GameClientInput } from "@project/shared";

/** Within this many px of the head, the pointer steers nowhere new (local_snake.gd). */
const DEAD_ZONE_PX = 4;

export class PointerInput {
  private pointer: { x: number; y: number } | null = null;
  private pointerDown = false;
  private spaceDown = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly worldPointAt: (clientX: number, clientY: number) => { x: number; y: number },
  ) {
    // the pointer steers from anywhere on the page, as Godot's global mouse did
    this.listen(window, "pointermove", (event) => {
      this.pointer = { x: event.clientX, y: event.clientY };
    });
    this.listen(canvas, "pointerdown", (event) => {
      if (event.button !== 0) return;
      this.pointerDown = true;
      this.pointer = { x: event.clientX, y: event.clientY };
      canvas.focus();
    });
    this.listen(window, "pointerup", (event) => {
      if (event.button === 0) this.pointerDown = false;
    });
    this.listen(window, "pointercancel", () => {
      this.pointerDown = false;
    });
    // Space boosts while the canvas holds the keyboard (the chat overlay
    // hands it back when it closes)
    this.listen(canvas, "keydown", (event) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      this.spaceDown = true;
    });
    this.listen(canvas, "keyup", (event) => {
      if (event.code === "Space") this.spaceDown = false;
    });
    this.listen(canvas, "blur", () => {
      this.spaceDown = false;
    });
    this.listen(window, "blur", () => {
      this.spaceDown = false;
      this.pointerDown = false;
    });
  }

  /** One step's input: aim from the head toward the pointer (the heading when it is on the head), and the boost. */
  public sample(head: { x: number; y: number }, dir: { dx: number; dy: number }): GameClientInput {
    const boost = this.pointerDown || this.spaceDown;
    if (this.pointer === null) return { dx: dir.dx, dy: dir.dy, boost };
    const target = this.worldPointAt(this.pointer.x, this.pointer.y);
    let dx = target.x - head.x;
    let dy = target.y - head.y;
    const mag = Math.hypot(dx, dy);
    if (mag < DEAD_ZONE_PX) return { dx: dir.dx, dy: dir.dy, boost };
    dx /= mag;
    dy /= mag;
    return { dx, dy, boost };
  }

  public destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private listen<K extends keyof WindowEventMap & keyof HTMLElementEventMap>(
    target: Window | HTMLCanvasElement,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }
}
