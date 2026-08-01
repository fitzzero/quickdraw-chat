/**
 * Seeded randomness for the bench harness. Same mulberry32 as GameWorldSim
 * so every random choice in a run (delays, behaviors) is reproducible from
 * the scenario seed.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a stream-specific seed so substreams don't correlate. */
export function deriveSeed(seed: number, streamId: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < streamId.length; i++) {
    h = Math.imul(h ^ streamId.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Standard normal via Box-Muller. */
export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
