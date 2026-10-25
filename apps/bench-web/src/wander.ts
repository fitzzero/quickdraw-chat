/**
 * The local snake aims at the mouse — in a bench browser nobody moves it, so
 * the runners drive a seeded wander through the REAL input path (Playwright
 * mouse → canvas → the client's pointer input). Mirrors the Tier-1 wander
 * behavior in spirit: a heading random-walk around the viewport's centre,
 * the odd boost via the left button.
 */

import type { Page } from "playwright";

export function startMouseWander(page: Page, seed: number, signal: { stopped: boolean }): void {
  let s = seed >>> 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let heading = rng() * Math.PI * 2;
  let angularVel = 0;
  let nextRollAt = 0;
  let boosting = false;
  const loop = async (): Promise<void> => {
    const start = Date.now();
    while (!signal.stopped) {
      const tSec = (Date.now() - start) / 1000;
      if (tSec >= nextRollAt) {
        angularVel = (rng() - 0.5) * 2 * 1.5;
        nextRollAt = tSec + 1 + rng() * 2;
        const wantBoost = rng() < 0.15;
        if (wantBoost !== boosting) {
          boosting = wantBoost;
          try {
            await (wantBoost ? page.mouse.down() : page.mouse.up());
          } catch {
            break;
          }
        }
      }
      heading += angularVel * 0.1;
      try {
        await page.mouse.move(640 + Math.cos(heading) * 220, 360 + Math.sin(heading) * 220);
      } catch {
        break;
      }
      await sleep(100);
    }
  };
  void loop();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}
