/**
 * bench:play — a guest session on a deployed (or local) game, played by a
 * human-like mouse from a real Chromium and measured from inside the page:
 * the snapshot arrival gaps and the ack deltas of the player's own snake,
 * read from the packed world stream itself (decoded with the shared
 * SnapshotDecoder); the rAF gaps and the long tasks of the main thread; the
 * input send gaps; the renderer's backend, draw calls and geometry builds
 * from the page's own stats line (`?debug=1`); and every socket open or
 * close. The check a person runs after a deploy:
 *
 *   bun run bench:play -- --url https://quickdraw-dev.techtree.gg/game --seconds 60
 *
 * Measured from the moment the player is in the world plus a settle second
 * (the page's load and the sign-in are not the deploy's stalls). Exit code 1
 * when a long task (50 ms or more on the main thread), a geometry build
 * after the first second, or an ack delta of 0 (a tick that stepped none of
 * the player's frames) appears: the shapes a stall takes. Headed, since
 * frame pacing is the point; --window-position puts the window on the
 * display meant (the 144 Hz one). The raw samples are saved beside the
 * bench results for a later look (play-report.ts does the arithmetic).
 */

import { execSync } from "node:child_process";
import { hostname } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import {
  LONG_TASK_MS,
  SETTLE_MS,
  report,
  type CliArgs,
  type PageSamples,
  type StatsSample,
} from "./play-report.js";
import { sleep, startMouseWander } from "./wander.js";

const RESULTS_DIR = resolve(process.cwd(), "../../bench-results/play");

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: "http://localhost:3000/game",
    seconds: 60,
    name: `probe-${Date.now().toString(36).slice(-4)}`,
    headless: false,
  };
  const next = (i: number): string => {
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${argv[i]} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") args.url = next(i++);
    else if (arg === "--seconds") args.seconds = Math.max(5, Number(next(i++)) || 60);
    else if (arg === "--name") args.name = next(i++);
    else if (arg === "--gpu") {
      const gpu = next(i++);
      if (gpu !== "webgl" && gpu !== "webgpu") throw new Error(`--gpu takes webgl or webgpu`);
      args.gpu = gpu;
    } else if (arg === "--window-position") args.windowPosition = next(i++);
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--help") {
      console.log(
        "usage: bench:play [--url <game url>] [--seconds N] [--name text] [--gpu webgl|webgpu] [--window-position x,y] [--headless]",
      );
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

/**
 * Installed before any page script: wraps WebSocket to time every message
 * of the world stream (and the seeds, hellos and game events around it) and
 * every input send, runs a rAF loop for the frame gaps, and observes long
 * tasks. Everything lands on `window.__quickdrawPlay`, drained from Node.
 * Times are epoch ms (performance.timeOrigin + performance.now()).
 */
const PAGE_HOOKS = `(() => {
  const P = { wire: [], sends: [], raf: [], longTasks: [], sockets: [] };
  window.__quickdrawPlay = P;
  const now = () => performance.timeOrigin + performance.now();
  const parse = (text) => {
    // socket.io over engine.io: "4" message, then "2" event or "3" ack, an optional ack id, the JSON
    if (text.charCodeAt(0) !== 52) return null;
    const kind = text.charCodeAt(1);
    if (kind !== 50 && kind !== 51) return null;
    const start = text.indexOf("[");
    if (start < 0) return null;
    try { return { ack: kind === 51, data: JSON.parse(text.slice(start)) }; } catch { return null; }
  };
  const onMessage = (text) => {
    const packet = parse(text);
    if (!packet) return;
    const t = now();
    if (packet.ack) {
      // a subscription's reply carries the seed: a keyframe naming every player
      const reply = packet.data[0];
      if (reply && Array.isArray(reply.seed)) {
        for (const item of reply.seed) if (item && typeof item.b === "string") P.wire.push({ t, b: item.b, seed: true, n: text.length });
      }
      return;
    }
    const [name, frame] = packet.data;
    if (name === "qd:stream" && Array.isArray(frame) && frame[0] === "gameService" && frame[1] === "world") {
      const item = frame[3];
      P.wire.push({ t, b: item && typeof item.b === "string" ? item.b : undefined, n: text.length });
    } else if (name === "qd:hello" && frame) {
      P.wire.push({ t, hello: { userId: frame.userId ?? null, serverId: frame.serverId ?? null } });
    } else if (name === "qd:event" && Array.isArray(frame) && frame[0] === "gameService") {
      P.wire.push({ t, event: String(frame[1]), id: frame[2] && frame[2].id ? String(frame[2].id) : null });
    }
  };
  const Native = window.WebSocket;
  class Hooked extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const id = P.sockets.length;
      P.sockets.push({ id, url: String(url), openedAt: null, closedAt: null, code: null });
      this.addEventListener("open", () => { P.sockets[id].openedAt = now(); });
      this.addEventListener("close", (e) => { P.sockets[id].closedAt = now(); P.sockets[id].code = e.code; });
      this.addEventListener("message", (e) => { if (typeof e.data === "string") onMessage(e.data); });
    }
  }
  const send = Native.prototype.send;
  Hooked.prototype.send = function (data) {
    if (typeof data === "string" && data.includes('"qd:ch"') && data.includes('"input"')) {
      let seq = null;
      const start = data.indexOf("[");
      try {
        const frames = JSON.parse(data.slice(start))[1][2].frames;
        seq = frames[frames.length - 1].seq;
      } catch {}
      P.sends.push({ t: now(), seq });
    }
    return send.call(this, data);
  };
  window.WebSocket = Hooked;
  let last = null;
  const tick = (t) => {
    if (last !== null) P.raf.push({ t: performance.timeOrigin + t, gap: t - last });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) P.longTasks.push({ t: performance.timeOrigin + entry.startTime, d: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
})();`;

/** Takes what the page recorded since the last drain (the sockets stay: a close may come later). */
async function drain(page: Page): Promise<PageSamples> {
  return (await page.evaluate(() => {
    const P = (window as unknown as { __quickdrawPlay?: Record<string, unknown[]> })
      .__quickdrawPlay;
    if (!P) return { wire: [], sends: [], raf: [], longTasks: [], sockets: [] };
    const out: Record<string, unknown[]> = {};
    for (const key of ["wire", "sends", "raf", "longTasks"]) {
      out[key] = P[key] ?? [];
      P[key] = [];
    }
    out.sockets = [...(P.sockets ?? [])];
    return out;
  })) as unknown as PageSamples;
}

const STATS_LINE =
  /^(\S+) · (\d+) fps · ([\d.]+)\/([\d.]+) ms work · (\S+) draws · (\d+) builds · tick (\d+)$/;

async function readStats(page: Page): Promise<StatsSample | null> {
  const text = await page
    .getByTestId("game-stats")
    .textContent({ timeout: 1000 })
    .catch(() => null);
  const match = text === null ? null : STATS_LINE.exec(text.trim());
  if (!match) return null;
  return {
    t: Date.now(),
    backend: match[1] ?? "…",
    fps: Number(match[2]),
    drawCalls: match[5] === "–" ? null : Number(match[5]),
    geometryBuilds: Number(match[6]),
    tick: Number(match[7]),
  };
}

function merge(into: PageSamples, more: PageSamples): void {
  into.wire.push(...more.wire);
  into.sends.push(...more.sends);
  into.raf.push(...more.raf);
  into.longTasks.push(...more.longTasks);
  into.sockets = more.sockets;
}

interface Session {
  samples: PageSamples;
  stats: StatsSample[];
  /** epoch ms: the player in the world, settled */
  since: number;
}

async function play(args: CliArgs): Promise<Session> {
  const browser = await chromium.launch({
    headless: args.headless,
    args: args.windowPosition === undefined ? [] : [`--window-position=${args.windowPosition}`],
  });
  const samples: PageSamples = { wire: [], sends: [], raf: [], longTasks: [], sockets: [] };
  const stats: StatsSample[] = [];
  let since = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(PAGE_HOOKS);
    const page = await context.newPage();
    const url = new URL(args.url);
    url.searchParams.set("debug", "1");
    if (args.gpu !== undefined) url.searchParams.set("gpu", args.gpu);
    console.log(`[bench:play] opening ${url.toString()} as "${args.name}" for ${args.seconds} s`);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

    // The guest sign-in, as a player does it
    const nameInput = page.getByPlaceholder(/snake name/i).first();
    await nameInput.waitFor({ timeout: 90_000 });
    await nameInput.fill(args.name);
    await page
      .getByRole("button", { name: /play as guest/i })
      .first()
      .click({ timeout: 30_000 });
    // the page's own snake: the stats line shows once the client renders
    await page.getByTestId("game-stats").waitFor({ timeout: 60_000 });
    since = Date.now() + SETTLE_MS;
    merge(samples, await drain(page));
    console.log(`[bench:play] in the world — playing (measured after ${SETTLE_MS} ms)…`);

    const signal = { stopped: false };
    startMouseWander(page, 0x9e3779b9, signal);
    const endAt = Date.now() + args.seconds * 1000;
    let nextDrain = Date.now() + 2000;
    while (Date.now() < endAt) {
      await sleep(500);
      const sample = await readStats(page);
      if (sample) stats.push(sample);
      if (Date.now() >= nextDrain) {
        merge(samples, await drain(page));
        nextDrain = Date.now() + 2000;
      }
    }
    signal.stopped = true;
    await sleep(150);
    merge(samples, await drain(page));
  } finally {
    await browser.close();
  }
  return { samples, stats, since };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.headless) {
  console.log(
    "[bench:play] headless: SwiftShader's frame pacing is not a display's; read the rAF line knowingly",
  );
}
const { samples, stats, since } = await play(args);
const passed = report(args, samples, stats, since);
mkdirSync(RESULTS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = join(RESULTS_DIR, `${stamp}-${new URL(args.url).hostname}-${gitCommit()}.json`);
const saved = {
  url: args.url,
  name: args.name,
  seconds: args.seconds,
  gpu: args.gpu ?? null,
  host: hostname(),
  since,
  longTaskMs: LONG_TASK_MS,
  stats,
  ...samples,
};
writeFileSync(file, `${JSON.stringify(saved, null, 1)}\n`);
console.log(`  saved → ${file}`);
process.exit(passed ? 0 : 1);
