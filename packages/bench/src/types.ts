/**
 * The netcode-bench contract: traces recorded by runners (Tier 1 headless
 * bots or Tier 2 real browsers), scenario definitions, and the scorecard
 * both tiers emit. Everything downstream (metrics, compare, the R&D loop)
 * works purely on these shapes.
 */

// ── Traces ────────────────────────────────────────────────────────────────

/** Authoritative server-side record, one entry per simulation tick. */
export interface ServerTrace {
  ticks: ServerTick[];
  deaths: { tick: number; tWall: number; id: string }[];
  /** the food the world held after each of the run's last ticks (ids sorted), to check the clients' */
  food?: { tick: number; ids: string[] }[];
}

export interface ServerTick {
  tick: number;
  /** epoch ms, sub-ms precision */
  tWall: number;
  tickDurMs: number;
  snapshotBytes: number;
  players: { id: string; x: number; y: number }[];
  /**
   * Per human snake alive and fed that tick (the sim's TickResult.inputs):
   * the frames it stepped, and the frames still queued after the take.
   */
  inputs: { id: string; stepped: number; depth: number }[];
}

/** What one client (bot or browser) saw and rendered. */
export interface ClientTrace {
  clientId: string;
  kind: "bot" | "browser";
  /** this client's own player id (undefined for spectators) */
  playerId?: string;
  /** rendered positions per render frame (epoch ms) */
  frames: ClientFrame[];
  /** snapshot arrivals */
  snapshots: { tWall: number; tick: number }[];
  /** reconciliation corrections applied to the local snake */
  corrections: { tWall: number; magnitudePx: number; hard: boolean }[];
  /** input frames sent; tAcked = arrival of first snapshot with ack >= seq */
  inputs: { seq: number; tSent: number; tAcked?: number }[];
  /** Tier 2 only */
  fpsSamples?: { tWall: number; fps: number }[];
  /**
   * the food the client held at the end, as of `tick` (its changes up to that
   * tick), its latest snapshot's tick, and the keyframes it asked for after gaps
   */
  food?: { tick: number; latestTick: number; ids: string[]; resyncs: number };
}

export interface ClientFrame {
  tWall: number;
  entities: Record<string, { x: number; y: number }>;
}

// ── Scenarios ─────────────────────────────────────────────────────────────

export type JitterModel =
  | { kind: "none" }
  | { kind: "normal"; sigmaMs: number }
  | { kind: "spike"; probPerChunk: number; minMs: number; maxMs: number }
  | { kind: "stall"; periodMs: number; durationMs: number };

export interface DirectionProfile {
  /** one-way propagation delay (ms) */
  baseMs: number;
  jitter: JitterModel;
}

export interface NetProfile {
  /** client → server (inputs) */
  up: DirectionProfile;
  /** server → client (snapshots) */
  down: DirectionProfile;
}

export type BehaviorKind = "wander" | "cross" | "orbit" | "spectator";

export interface BotSpec {
  /** stable name → deterministic user creation and trace identity */
  name: string;
  behavior: { kind: BehaviorKind; params?: Record<string, number> };
  /** omit for a direct (unproxied) connection */
  net?: NetProfile;
  /**
   * Render-clock profile: frame rate oscillates sinusoidally between
   * minFps and maxFps with the given period (like a browser under varying
   * load). Omit for a steady 60fps. Deterministic — no randomness.
   */
  render?: { minFps: number; maxFps: number; periodS: number; phaseS?: number };
  /**
   * Scales the time the bot's predictor sees (default 1): its fixed-step
   * accumulator then emits input frames at tickRate × clockScale, while its
   * world clock and render clock stay on wall time. Models a client whose
   * tick clock drifts (1.01 runs 1% fast), nothing else.
   */
  clockScale?: number;
}

/** A loopback link's lag, both ways: each message `ms` plus up to `jitter` ms, `loss` of `fast` ones lost. */
export interface LinkLag {
  ms: number;
  jitter: number;
  loss: number;
}

/**
 * A party (host mode): no server. A host in process runs the party's sim
 * and loop, and each bot plays over a loopback link to it.
 */
export interface PartySpec {
  /** The bot of the host's own user: its game runs on the host's machine, over a link no network slows. */
  host: string;
  /** Every other bot's link to the host. */
  link: LinkLag;
  /**
   * The fair link, as the host's page sets it (settleFairLink, every
   * FAIR_LINK_EVERY_MS): the host's own user's link lags by the other
   * players' median one-way trip. False plays with the advantage it removes.
   */
  fairLink: boolean;
}

export interface Scenario {
  name: string;
  description: string;
  seed: number;
  durationMs: number;
  /** measurements start after this much wall time */
  warmupMs: number;
  respawnDelayMs: number;
  /** GameTunables overrides (npcCount etc.) — validated server-side */
  tunables?: Record<string, number>;
  clients: BotSpec[];
  /** A party instead of the server's world: its bots play over its links, and take no `net`. */
  party?: PartySpec;
}

// ── Scorecard ─────────────────────────────────────────────────────────────

export interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface PacketHealth {
  interArrivalMs: Stats;
  /** snapshots received per second (server sends at 20Hz) */
  effectiveRate: number;
  /** fraction of ticks missed between consecutive arrivals (volatile drops/coalescing) */
  gapRate: number;
  maxConsecutiveMissedTicks: number;
  inputAckRttMs: Stats;
}

export interface SmoothnessReport {
  teleportsPerMin: number;
  /** RMS of frame-to-frame acceleration (px/s²) across rendered entities */
  jerkRms: number;
  hardSnapsPerMin: number;
  correctionPx: Stats;
}

export interface EntityFidelity {
  /** lag (ms) that best aligns this client's render of the entity to the server track */
  renderLatencyMs: number;
  /** residual error after removing that lag — trajectory fidelity */
  shapeErrorPx: Stats;
}

/**
 * The server's view of the clients' clocks, from the input queue: per tick
 * of a live human snake that has stepped a frame since it spawned, warmup
 * excluded.
 */
export interface InputQueueReport {
  /** frames still queued after a tick's take, p95 */
  depthP95: number;
  /** ticks the snake had no frame to step (it coasted on its last intent) */
  starvedRate: number;
  /** ticks the snake stepped two or more frames (catching up) */
  multiStepRate: number;
  /** mean depth over the window's last 10 s minus its first 10 s: a queue ratcheting toward its cap grows it */
  depthTrend: number;
}

export interface ClientReport {
  kind: "bot" | "browser";
  packet: PacketHealth;
  smoothness: SmoothnessReport;
  /** keyed by entity (player) id as seen by this client */
  perEntity: Record<string, EntityFidelity>;
  /** local-snake raw (lag=0) prediction error vs server */
  predictionErrorPx?: Stats;
  /** measured render frame rate (bots target 60) */
  effectiveFps: number;
  /** the server's view of this client's own snake (players only) */
  inputQueue?: InputQueueReport;
  /** food ids the client and the server disagreed on at the client's latest snapshot (0: none) */
  foodMismatchAtEnd?: number;
  /** keyframes the client asked for after missing more snapshots than the food window */
  foodResyncs?: number;
}

/** A party's fairness: the host's own user against the other players, the medians of theirs. */
export interface PartyFairness {
  /** The bot of the host's own user. */
  host: string;
  /** Input → ack round trip p50 (ms). */
  inputAckRttP50: { host: number; peers: number };
  /** Local prediction error p95 (px). */
  predictionErrorP95: { host: number; peers: number };
}

export interface Scorecard {
  /** 2 since the food window (clients' food); `loadScorecard` reads 1 too */
  schemaVersion: 1 | 2;
  scenario: string;
  seed: number;
  tier: 1 | 2;
  gitCommit: string;
  branch: string;
  label?: string;
  createdAt: string;
  durationMs: number;
  /** number of runs aggregated (median-of-N on headline metrics) */
  runs: number;
  server: {
    tickDurMs: Stats;
    snapshotBytes: Stats;
    effectiveTickRate: number;
    /** every human snake's queue together; absent from scorecards made before the input queue */
    inputQueue?: InputQueueReport;
  };
  clients: Record<string, ClientReport>;
  divergence: {
    /** entity is one client's own snake: predicted-now vs remote-interp views */
    ownVsRemotePx: Stats;
    /** both clients see the entity remotely — the purest desync signal */
    remoteVsRemotePx: Stats;
  };
  /** spread of headline p50s across the N runs (comparability guard) */
  runVariance?: Record<string, number>;
  /**
   * aggregated cards: each headline metric's worst (highest) run; a run
   * without the metric makes it NaN, which a saved card holds as null
   */
  runWorst?: Record<string, number | null>;
  tier2?: {
    fps: Stats;
    frameTimeMs: Stats;
  };
  /** A party scenario's fairness (reported, not compared) */
  party?: PartyFairness;
}

/** One run's raw material for scoring. */
export interface RunTraces {
  server: ServerTrace;
  clients: ClientTrace[];
}
