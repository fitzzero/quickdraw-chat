/**
 * The browser tier's own numbers: what the page's render loop and main
 * thread did while the netcode ran. The tails and the counts are the
 * headline (frame time p95 and p99, long tasks and geometry builds a
 * minute), never the mean or the average fps: a stall of 200 ms every
 * fifteen seconds leaves the average untouched and is the whole bug.
 */

import type { ClientTrace, Scorecard } from "../types.js";
import { computeStats } from "./tracks.js";

export type Tier2Report = NonNullable<Scorecard["tier2"]>;

/** The time between a client's consecutive rendered frames within the window (a gap of a second or more is a pause, not a frame). */
function frameTimesOf(client: ClientTrace, inWindow: (tWall: number) => boolean): number[] {
  const times: number[] = [];
  for (let i = 1; i < client.frames.length; i++) {
    const cur = client.frames[i];
    const prev = client.frames[i - 1];
    if (!cur || !prev || !inWindow(cur.tWall)) continue;
    const dt = cur.tWall - prev.tWall;
    if (dt > 0 && dt < 1000) times.push(dt);
  }
  return times;
}

/**
 * The Tier-2 block of a scorecard, from the browser clients' traces within
 * the window: the frame times between their rendered frames, their fps
 * samples, their long tasks and their renderers' samples. Geometry builds
 * are counted as the increases between a client's consecutive samples, so a
 * renderer that mounted again (its count starting over) adds nothing but
 * what it built.
 */
export function computeTier2(
  clients: readonly ClientTrace[],
  windowStart: number,
  windowEnd: number,
): Tier2Report {
  const minutes = Math.max((windowEnd - windowStart) / 60_000, 1e-9);
  const inWindow = (tWall: number): boolean => tWall >= windowStart && tWall <= windowEnd;
  const fpsValues = clients.flatMap((c) =>
    (c.fpsSamples ?? []).filter((s) => inWindow(s.tWall)).map((s) => s.fps),
  );
  const frameTimes = clients.flatMap((c) => frameTimesOf(c, inWindow));
  const longTasks = clients.flatMap((c) => (c.longTasks ?? []).filter((t) => inWindow(t.tWall)));
  const backends = new Set<string>();
  const draws: number[] = [];
  let builds = 0;
  for (const client of clients) {
    const renderer = client.renderer;
    if (!renderer) continue;
    if (renderer.backend !== null) backends.add(renderer.backend);
    const samples = renderer.samples.filter((s) => inWindow(s.tWall));
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!sample) continue;
      if (sample.drawCalls !== null) draws.push(sample.drawCalls);
      const previous = i > 0 ? samples[i - 1] : undefined;
      if (previous && sample.geometryBuilds > previous.geometryBuilds) {
        builds += sample.geometryBuilds - previous.geometryBuilds;
      }
    }
  }
  return {
    fps: computeStats(fpsValues),
    frameTimeMs: computeStats(frameTimes),
    longTasksPerMin: longTasks.length / minutes,
    geometryBuildsPerMin: builds / minutes,
    drawCalls: computeStats(draws),
    backend: backends.size > 0 ? [...backends].sort().join("+") : "unknown",
  };
}

/**
 * The browser tier's headline metrics, present on a card with a Tier-2 block
 * and finite there (a card made before a metric existed leaves it out, so a
 * compare never judges it against nothing).
 */
export function tier2Metrics(card: Scorecard): Record<string, number> {
  const tier2 = card.tier2;
  if (!tier2) return {};
  const out: Record<string, number> = {};
  const put = (key: string, value: number | undefined): void => {
    if (value !== undefined && Number.isFinite(value)) out[key] = value;
  };
  put("tier2.frameTimeMs.p95", tier2.frameTimeMs.p95);
  put("tier2.frameTimeMs.p99", tier2.frameTimeMs.p99);
  put("tier2.longTasksPerMin", tier2.longTasksPerMin);
  put("tier2.geometryBuildsPerMin", tier2.geometryBuildsPerMin);
  return out;
}
