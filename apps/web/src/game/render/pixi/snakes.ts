/**
 * One snake as drawn (snake_body.gd): its segments as pooled particles in
 * one particle container (the glows first, under the bodies), its head as a
 * few sprites in a container the renderer keeps in a layer above every
 * snake's segments (so all heads and labels batch together), its name as a
 * text label set only when the name changes. Per frame the body-path walk
 * places the particles and the head moves; particles are added as the snake
 * grows and dropped as it shrinks, never rebuilt.
 */

import { Container, Particle, ParticleContainer, Sprite, Text, type Texture } from "pixi.js";
import type { RenderedSnake } from "@project/shared";
import { BodyPath, type BodySegment } from "../bodyPath";
import { bodyColor, darken, glowColor } from "../palette";
import type { RenderTunables } from "../renderer";
import { scaleFor } from "./textures";

const LABEL_STYLE = {
  fontSize: 12,
  fill: 0xffffff,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export class SnakeView {
  /** The segments: one draw call. */
  public readonly segments: ParticleContainer<Particle>;
  /** The head, its glow, flare, eyes and label: batched with every other head's. */
  public readonly head = new Container();
  /** The frame that last drew this snake; one a frame did not draw is gone. */
  public stamp = 0;
  private readonly flare: Sprite;
  private readonly headGlow: Sprite;
  private readonly headBody: Sprite;
  private readonly label: Text;
  private readonly path = new BodyPath();
  private readonly walk: BodySegment[] = [];
  private readonly glows: Particle[] = [];
  private readonly bodies: Particle[] = [];
  private body = 0;
  private glow = 0;
  private placed = false;

  constructor(
    private readonly texture: Texture,
    hue: number,
    name: string,
    private readonly tunables: RenderTunables,
  ) {
    this.segments = new ParticleContainer<Particle>({
      texture,
      dynamicProperties: {
        position: true,
        scale: true,
        rotation: false,
        uvs: false,
        color: false,
        vertex: false,
      },
    });
    const sprite = (radius: number, alpha = 1): Sprite => {
      const s = new Sprite({ texture, anchor: 0.5 });
      s.scale.set(scaleFor(radius));
      s.alpha = alpha;
      return s;
    };
    const { headRadius } = tunables;
    // snake_body.gd _draw's head: boost flare, glow, head, two eyes
    this.flare = sprite(headRadius + 6, 0.25);
    this.flare.visible = false;
    this.headGlow = sprite(headRadius + 3, 0.35);
    this.headBody = sprite(headRadius);
    const eye1 = sprite(2.5);
    eye1.position.set(3, -3);
    const eye2 = sprite(2.5);
    eye2.position.set(3, 3);
    this.label = new Text({ text: name, style: LABEL_STYLE, resolution: 2 });
    this.label.alpha = 0.8;
    this.label.position.set(-30, -34);
    this.head.addChild(this.flare, this.headGlow, this.headBody, eye1, eye2, this.label);
    this.setHue(hue);
  }

  /** The player's hue: the body and glow colors, on the head and every segment. */
  public setHue(hue: number): void {
    this.body = bodyColor(hue);
    this.glow = glowColor(hue);
    this.headGlow.tint = this.glow;
    this.headBody.tint = this.body;
    for (const p of this.glows) p.tint = this.glow;
    this.bodies.forEach((p, i) => {
      p.tint = darken(this.body, 0.1 + 0.02 * (i % 2));
    });
    this.segments.update();
  }

  /** The player's name; the label is laid out again only when it changes. */
  public setName(name: string): void {
    if (this.label.text !== name) this.label.text = name;
  }

  /** The body history starts over at the next frame's head (a hard snap). */
  public resetPath(): void {
    this.placed = false;
  }

  /** One frame: the head where the core rendered it, the body walked back from it. */
  public update(snake: RenderedSnake): void {
    if (!this.placed) {
      this.path.reset(snake.x, snake.y);
      this.placed = true;
    }
    this.path.advance(snake.x, snake.y, snake.len, this.tunables);
    const n = this.path.segments(snake.x, snake.y, snake.len, this.tunables, this.walk);
    this.fit(n);
    for (let i = 0; i < n; i++) {
      const seg = this.walk[i];
      const glow = this.glows[i];
      const body = this.bodies[i];
      if (seg === undefined || glow === undefined || body === undefined) break;
      glow.x = body.x = seg.x;
      glow.y = body.y = seg.y;
      glow.scaleX = glow.scaleY = scaleFor(seg.radius + 3);
      body.scaleX = body.scaleY = scaleFor(seg.radius);
    }
    this.head.position.set(snake.x, snake.y);
    this.flare.visible = snake.boost;
  }

  /**
   * Grows or shrinks the pools to `n` segments (snake_body.gd draws
   * int(length) of them) and lays the container's children out again: the
   * glows first, so every body draws over every glow.
   */
  private fit(n: number): void {
    if (this.glows.length === n) return;
    if (this.glows.length > n) {
      this.glows.length = n;
      this.bodies.length = n;
    } else {
      for (let i = this.glows.length; i < n; i++) {
        this.glows.push(
          new Particle({
            texture: this.texture,
            anchorX: 0.5,
            anchorY: 0.5,
            tint: this.glow,
            alpha: 0.35,
          }),
        );
        this.bodies.push(
          new Particle({
            texture: this.texture,
            anchorX: 0.5,
            anchorY: 0.5,
            tint: darken(this.body, 0.1 + 0.02 * (i % 2)),
          }),
        );
      }
    }
    const children = this.segments.particleChildren;
    children.length = 0;
    children.push(...this.glows, ...this.bodies);
    this.segments.update();
  }

  public destroy(): void {
    this.segments.destroy();
    this.head.destroy({ children: true });
  }
}
