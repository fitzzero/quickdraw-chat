/**
 * TCP latency proxy — puts a configurable one-way delay + jitter between a
 * client and the API server, per direction. Works identically for headless
 * socket.io clients and real browsers (CDP throttling can't touch
 * WebSockets, so this is the one impairment mechanism both tiers share).
 *
 * Honesty notes, because TCP cannot lose or reorder application data:
 * - Jitter is FIFO-preserving: a late chunk delays everything behind it
 *   ("clumping"), which is exactly the real-world snapshot-burst pathology.
 * - There is no packet "loss". The `stall` model instead PAUSES reads from
 *   the source socket, propagating genuine TCP backpressure to the sender.
 *   On the server→client direction that grows engine.io's write buffer until
 *   `.volatile.emit` snapshots are genuinely dropped — the real mechanism by
 *   which slow clients miss frames.
 * - Delay *samples* are seeded (reproducible); actual chunk timing still
 *   depends on OS scheduling.
 */

import { createServer, createConnection, type Server, type Socket } from "node:net";
import type { DirectionProfile, JitterModel } from "./types.js";
import { deriveSeed, mulberry32, normal, type Rng } from "./prng.js";

export interface LatencyProxyConfig {
  targetHost: string;
  targetPort: number;
  /** 0/undefined = ephemeral */
  listenPort?: number;
  up: DirectionProfile;
  down: DirectionProfile;
  seed: number;
}

export interface LatencyProxy {
  port: number;
  stats(): ProxyStats;
  stop(): Promise<void>;
}

export interface ProxyStats {
  connections: number;
  bytesUp: number;
  bytesDown: number;
  meanAppliedDelayMs: { up: number; down: number };
}

function makeJitterSampler(model: JitterModel, rng: Rng): () => number {
  switch (model.kind) {
    case "none":
      return () => 0;
    case "normal":
      return () => Math.max(0, normal(rng) * model.sigmaMs);
    case "spike":
      return () =>
        rng() < model.probPerChunk ? model.minMs + rng() * (model.maxMs - model.minMs) : 0;
    // Stall is time-driven, not per-chunk — handled by pauseWindows below
    case "stall":
      return () => 0;
  }
}

/**
 * Forward one direction with delay. Chunks are timestamped on arrival and
 * released no earlier than `arrival + base + jitter`, FIFO order enforced.
 */
function pipeDelayed(
  source: Socket,
  dest: Socket,
  profile: DirectionProfile,
  rng: Rng,
  onBytes: (n: number) => void,
  onDelay: (ms: number) => void,
): void {
  const jitter = makeJitterSampler(profile.jitter, rng);
  let lastDeliverAt = 0;
  let pending = 0;
  let sourceEnded = false;

  // Time-driven stall: pause reads from the source in a fixed cycle so the
  // sender feels real backpressure (see module header).
  if (profile.jitter.kind === "stall") {
    const { periodMs, durationMs } = profile.jitter;
    const cycle = () => {
      if (source.destroyed) return;
      source.pause();
      setTimeout(() => {
        if (!source.destroyed) source.resume();
      }, durationMs).unref();
    };
    const timer = setInterval(cycle, periodMs);
    timer.unref();
    source.once("close", () => clearInterval(timer));
  }

  source.on("data", (chunk: Buffer) => {
    onBytes(chunk.length);
    const now = Date.now();
    const delay = profile.baseMs + jitter();
    const deliverAt = Math.max(lastDeliverAt, now + delay);
    lastDeliverAt = deliverAt;
    onDelay(deliverAt - now);
    pending++;
    setTimeout(() => {
      pending--;
      if (!dest.destroyed) {
        dest.write(chunk);
        if (sourceEnded && pending === 0) dest.end();
      }
    }, deliverAt - now);
  });

  // Propagate FIN only after all delayed chunks have flushed
  source.on("end", () => {
    sourceEnded = true;
    if (pending === 0 && !dest.destroyed) dest.end();
  });
  source.on("error", () => dest.destroy());
}

export function startLatencyProxy(cfg: LatencyProxyConfig): Promise<LatencyProxy> {
  let connections = 0;
  let bytesUp = 0;
  let bytesDown = 0;
  const delaySums = { up: 0, down: 0 };
  const delayCounts = { up: 0, down: 0 };
  const sockets = new Set<Socket>();

  const server: Server = createServer((client) => {
    const connId = connections++;
    const upstream = createConnection({ host: cfg.targetHost, port: cfg.targetPort });
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    upstream.on("error", () => client.destroy());
    client.once("close", () => sockets.delete(client));
    upstream.once("close", () => sockets.delete(upstream));

    upstream.on("connect", () => {
      pipeDelayed(
        client,
        upstream,
        cfg.up,
        mulberry32(deriveSeed(cfg.seed, `up:${connId}`)),
        (n) => (bytesUp += n),
        (ms) => {
          delaySums.up += ms;
          delayCounts.up++;
        },
      );
      pipeDelayed(
        upstream,
        client,
        cfg.down,
        mulberry32(deriveSeed(cfg.seed, `down:${connId}`)),
        (n) => (bytesDown += n),
        (ms) => {
          delaySums.down += ms;
          delayCounts.down++;
        },
      );
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.listenPort ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("latency proxy: no listen address"));
        return;
      }
      resolve({
        port: address.port,
        stats: () => ({
          connections,
          bytesUp,
          bytesDown,
          meanAppliedDelayMs: {
            up: delayCounts.up > 0 ? delaySums.up / delayCounts.up : 0,
            down: delayCounts.down > 0 ? delaySums.down / delayCounts.down : 0,
          },
        }),
        stop: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}
