/**
 * Telemetry for the browser tier of the netcode bench (`?bench=1`, driven
 * by apps/bench-web over Playwright): per render frame the rendered head of
 * every snake, plus snapshot arrivals, input sends, corrections (each with
 * the ack of the snapshot it reconciled against, which the runner pairs
 * with the sends for the input round trip), fps, the page's long tasks and
 * the renderer's stats with the main thread's work per frame, flushed as
 * JSON batches to `window.QuickdrawBench.push` every 500 ms for the runner
 * to drain. The shape is the one apps/bench-web/src/run.ts ingests, with
 * `longTasks` and `renderer` beside it. Times are epoch ms, the clock the
 * core and the server's ground truth share.
 */

import type { RenderedWorld } from "@project/shared";
import type { RendererStats } from "./render/renderer";

export interface BenchSink {
  push(json: string): void;
}

/** The batches the page collects for the runner to drain (apps/bench-web): the page defines it before the client starts. */
export interface QuickdrawBenchSink extends BenchSink {
  batches: unknown[];
  drain(): unknown[];
}

declare global {
  interface Window {
    QuickdrawBench?: QuickdrawBenchSink;
  }
}

const FLUSH_INTERVAL_MS = 500;
const FPS_SAMPLE_MS = 1000;

export class BenchTelemetry {
  private frames: { t: number; e: Record<string, [number, number]> }[] = [];
  private snapshots: { t: number; tick: number }[] = [];
  private inputs: { seq: number; t: number }[] = [];
  private corrections: { t: number; m: number; h: boolean; a: number }[] = [];
  private fps: { t: number; v: number }[] = [];
  private longTasks: { t: number; d: number }[] = [];
  private renderer: {
    t: number;
    backend: string | null;
    drawCalls: number | null;
    geometryBuilds: number;
    frameWorkMs: { p99: number; mean: number };
  }[] = [];
  private framesSinceSample = 0;
  private lastFpsSample = 0;
  private lastFlush = 0;
  private observer: PerformanceObserver | null = null;

  constructor(private readonly sink: BenchSink) {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.push({ t: performance.timeOrigin + entry.startTime, d: entry.duration });
        }
      });
      this.observer.observe({ type: "longtask", buffered: true });
    } catch {
      this.observer = null;
    }
  }

  /** One render frame: where every snake's head was drawn. */
  public frame(tWall: number, rendered: RenderedWorld, localId: string | null): void {
    const e: Record<string, [number, number]> = {};
    if (rendered.local !== null && localId !== null)
      e[localId] = [rendered.local.x, rendered.local.y];
    for (const [id, snake] of rendered.remotes) e[id] = [snake.x, snake.y];
    this.frames.push({ t: tWall, e });
    this.framesSinceSample += 1;
    if (this.lastFpsSample === 0) this.lastFpsSample = tWall;
    else if (tWall - this.lastFpsSample >= FPS_SAMPLE_MS) {
      this.fps.push({
        t: tWall,
        v: (this.framesSinceSample * 1000) / (tWall - this.lastFpsSample),
      });
      this.framesSinceSample = 0;
      this.lastFpsSample = tWall;
    }
  }

  public snapshot(tWall: number, tick: number): void {
    this.snapshots.push({ t: tWall, tick });
  }

  public input(seq: number, tWall: number): void {
    this.inputs.push({ seq, t: tWall });
  }

  /** The local snake reconciled against an own snapshot that acknowledged `ack`. */
  public correction(tWall: number, magnitudePx: number, hard: boolean, ack: number): void {
    this.corrections.push({ t: tWall, m: magnitudePx, h: hard, a: ack });
  }

  /** The renderer's stats and the main thread's work per frame, every half second. */
  public rendererStats(
    tWall: number,
    stats: RendererStats & { frameWorkMs: { p99: number; mean: number } },
  ): void {
    this.renderer.push({ t: tWall, ...stats });
  }

  /** Sends the batch when 500 ms passed since the last. */
  public flushIfDue(tWall: number): void {
    if (this.lastFlush === 0) this.lastFlush = tWall;
    if (tWall - this.lastFlush < FLUSH_INTERVAL_MS) return;
    this.lastFlush = tWall;
    this.sink.push(
      JSON.stringify({
        frames: this.frames,
        snapshots: this.snapshots,
        inputs: this.inputs,
        corrections: this.corrections,
        fps: this.fps,
        longTasks: this.longTasks,
        renderer: this.renderer,
      }),
    );
    this.frames = [];
    this.snapshots = [];
    this.inputs = [];
    this.corrections = [];
    this.fps = [];
    this.longTasks = [];
    this.renderer = [];
  }

  public destroy(): void {
    this.observer?.disconnect();
  }
}
