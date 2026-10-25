/**
 * The one texture everything round is drawn with: a white circle, tinted
 * per sprite. Generated once at mount; every food item, body segment, head,
 * eye and glow is a sprite or a particle of it, so Pixi batches them into a
 * few draw calls and nothing is tessellated per frame.
 */

import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

/** The texture's side, in px. */
export const CIRCLE_TEXTURE_PX = 64;
/** The circle's radius inside it: a px of margin keeps the antialiased edge in. */
export const CIRCLE_RADIUS_PX = 31;

export function makeCircleTexture(renderer: Renderer): Texture {
  const graphics = new Graphics()
    .circle(CIRCLE_TEXTURE_PX / 2, CIRCLE_TEXTURE_PX / 2, CIRCLE_RADIUS_PX)
    .fill(0xffffff);
  const texture = renderer.generateTexture({
    target: graphics,
    frame: new Rectangle(0, 0, CIRCLE_TEXTURE_PX, CIRCLE_TEXTURE_PX),
    resolution: 2,
    antialias: true,
  });
  graphics.destroy();
  return texture;
}

/** The sprite scale that draws the circle texture at `radius` px. */
export function scaleFor(radius: number): number {
  return radius / CIRCLE_RADIUS_PX;
}
