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

/** A gap between rendered frames this long is a pause, counted apart from the frame times. */
const PAUSE_MS = 1000;

/**
 * The time between a client's consecutive rendered frames within the
 * window, and the pauses (gaps of PAUSE_MS or more), which would otherwise
 * hide in a tail: they are counted, and must be 0.
 */
function frameTimesOf(
  client: ClientTrace,
  inWindow: (tWall: number) => boolean,
): { times: number[]; pauses: number } {
  const times: number[] = [];
  let pauses = 0;
  for (let i = 1; i < client.frames.length; i++) {
    const cur = client.frames[i];
    const prev = client.frames[i - 1];
    if (!cur || !prev || !inWindow(cur.tWall)) continue;
    const dt = cur.tWall - prev.tWall;
    if (dt >= PAUSE_MS) pauses += 1;
    else if (dt > 0) times.push(dt);
  }
  return { times, pauses };
}

/**
 * The Tier-2 block of a scorecard, from the browser clients' traces within
 * the window: the frame times between their rendered frames, their fps
 * samples, their long tasks and their renderers' samples. Geometry builds
 * are counted as the increases between a client's consecutive samples
 * within the window, so a renderer that mounted again (its count starting
 * over) adds nothing but what it built; a build between the last sample
 * before the window and the first inside it is not seen (the warmup is for
 * that). The work per frame is each sample's p99 of the half second before
 * it, reported beside the frame times: the gap between frames is capped by
 * the display, the work says how much of each frame the loop used.
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
  const frames = clients.map((c) => frameTimesOf(c, inWindow));
  const frameTimes = frames.flatMap((f) => f.times);
  const pauses = frames.reduce((sum, f) => sum + f.pauses, 0);
  const longTasks = clients.flatMap((c) => (c.longTasks ?? []).filter((t) => inWindow(t.tWall)));
  const backends = new Set<string>();
  const draws: number[] = [];
  const work: number[] = [];
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
      if (sample.frameWorkP99Ms !== undefined) work.push(sample.frameWorkP99Ms);
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
    pausesPerMin: pauses / minutes,
    drawCalls: computeStats(draws),
    frameWorkMs: computeStats(work),
    backend: backends.size > 0 ? [...backends].sort().join("+") : "unknown",
  };
}

/**
 * The browser tier's headline metrics, present on a card with a Tier-2 block
 * and finite there (a card made before a metric existed leaves it out, so a
 * compare never judges it against nothing); the frame-time tails only when a
 * frame was rendered, since the tails of nothing are 0. The work per frame
 * and the draw calls are reported, not compared.
 */
export function tier2Metrics(card: Scorecard): Record<string, number> {
  const tier2 = card.tier2;
  if (!tier2) return {};
  const out: Record<string, number> = {};
  const put = (key: string, value: number | undefined): void => {
    if (value !== undefined && Number.isFinite(value)) out[key] = value;
  };
  if (tier2.frameTimeMs.n > 0) {
    put("tier2.frameTimeMs.p95", tier2.frameTimeMs.p95);
    put("tier2.frameTimeMs.p99", tier2.frameTimeMs.p99);
  }
  put("tier2.longTasksPerMin", tier2.longTasksPerMin);
  put("tier2.geometryBuildsPerMin", tier2.geometryBuildsPerMin);
  put("tier2.pausesPerMin", tier2.pausesPerMin);
  return out;
}
