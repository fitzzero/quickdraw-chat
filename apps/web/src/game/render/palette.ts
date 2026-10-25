/**
 * The game's colors, chosen in HSV, as
 * 0xRRGGBB numbers an engine tints a white texture with.
 */

/** The page's background behind the world: the surface's box and the engine's clear color. */
export const GAME_BACKGROUND = 0x14171e;
export const GAME_BACKGROUND_CSS = "#14171e";

/** HSV to a packed RGB number; `h` in [0, 1), `s` and `v` in [0, 1]. */
export function hsv(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const u = v * (1 - (1 - f) * s);
  let r: number;
  let g: number;
  let b: number;
  switch (i % 6) {
    case 0:
      [r, g, b] = [v, u, p];
      break;
    case 1:
      [r, g, b] = [q, v, p];
      break;
    case 2:
      [r, g, b] = [p, v, u];
      break;
    case 3:
      [r, g, b] = [p, q, v];
      break;
    case 4:
      [r, g, b] = [u, p, v];
      break;
    default:
      [r, g, b] = [v, p, q];
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Each channel scaled toward black by `amount`. */
export function darken(rgb: number, amount: number): number {
  const k = 1 - amount;
  const r = Math.round(((rgb >> 16) & 0xff) * k);
  const g = Math.round(((rgb >> 8) & 0xff) * k);
  const b = Math.round((rgb & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/** A food item's hue from its id (food_layer.gd hashes the id the same way, by intent): 0..359. */
export function hashHue(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** A snake's body color (snake_body.gd): hue in degrees. */
export function bodyColor(hue: number): number {
  return hsv(hue / 360, 0.7, 0.9);
}

/** A snake's glow (snake_body.gd), drawn at alpha 0.35. */
export function glowColor(hue: number): number {
  return hsv(hue / 360, 0.5, 1.0);
}

/** A food item's color (food_layer.gd), its glow at alpha 0.25. */
export function foodColor(id: string): number {
  return hsv(hashHue(id) / 360, 0.6, 1.0);
}
