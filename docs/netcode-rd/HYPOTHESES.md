# Netcode R&D — Hypothesis Backlog

Prioritized by suspected impact on the observed rubberbanding/jitter between
real devices. Each entry names the change, where it lives, what scorecard
movement would confirm it, and its wire-format impact. Work top-down; the
loop (`/netcode-rd`) picks the first hypothesis not yet in the LEDGER.

## 1. Global world clock (shared tick estimator)

Every `RemoteSnake` keeps its OWN `_tick_est`, nudged 5% per render frame
toward its freshest snapshot (`remote_snake.gd:47-48`). Two remotes on one
screen can render at slightly different world times, and the nudge factor is
frame-rate dependent (5%/frame ≈ different time constants at 30 vs 144fps).

- Change: one world-clock estimator per client, fed by every snapshot
  arrival; all interpolators render at `worldClock − delay`. Use the
  frame-rate-independent form `est += (target − est) * (1 − exp(−dt/τ))`.
- Files: `apps/api/src/bench/bot/interpolation.ts` (+ a shared clock owned by
  the bot client), then `remote_snake.gd`/`main.gd`.
- Confirm: `remoteVsRemotePx` ↓ (esp. jitter-heavy), `jerkRms` ↓, no
  `renderLatencyMs` increase.
- Wire: none.

## 2. Snapshot send-timestamp + offset estimation

`WorldSnapshot` carries only `tick`. The client cannot distinguish "snapshot
late because network" from "server tick drifted"; the estimator conflates
them. Adding server send time enables a proper offset+RTT filter (NTP-style,
min-over-window) instead of nudging toward the freshest tick.

- Change: add `t` (epoch ms, quantized) to `WorldSnapshot`; client estimates
  offset via exponential min-filter; world clock derives from offset, not
  arrival nudges.
- Files: `packages/shared/src/types/game.ts`, `world.ts buildSnaps` (loop
  stamps it), bot interpolation/clock, then GDScript.
- Confirm: `remoteVsRemotePx` ↓ under jitter/bursty; interArrival spikes stop
  propagating into rendered motion (`jerkRms` ↓ in bursty-3p).
- Wire: +~8 bytes/snapshot. Cheap.

## 3. Adaptive interpolation delay

`INTERP_DELAY_TICKS := 2.5` is fixed. Under clean 50ms links it wastes
~50ms of perceived delay; under 150ms+spiky links it underruns into
extrapolation (visible warps).

- Change: per-client delay = clamp(p99 of recent snapshot inter-arrival
  jitter + margin, min 1.5, max 6 ticks), slewed slowly (≤0.1 tick/s) so the
  timeline never jumps.
- Confirm: jitter-heavy: `teleportsPerMin`/`jerkRms` ↓; control/baseline:
  `renderLatencyMs` ↓ vs today with no smoothness cost.
- Wire: none.

## 4. Velocity-aware (Hermite) interpolation

Remotes lerp positions and IGNORE the `dx,dy` velocity already on the wire.
Linear segments turn 20Hz samples of a curving snake into a polyline —
visible direction popping at segment boundaries.

- Change: cubic Hermite between bracketing snaps using `dir × speed` as
  tangents (speed from boost flag + tunables).
- Confirm: `shapeErrorPx` ↓, `jerkRms` ↓ at unchanged `renderLatencyMs`.
- Wire: none.

## 5. Input redundancy

Each input frame is sent once, fire-and-forget. A delayed/dropped frame
stalls the server's view of intent for ≥50ms → reconciliation corrections.

- Change: send the last N (=3) unacked frames per packet; server applies
  latest-wins (already seq-guarded — `applyInput` ignores stale seqs).
  Mind the channel rate limit (30/s) — bundle in ONE message, not N.
- Files: shared channel schema (array payload), `game/index.ts` channel
  handler, bot prediction sender, then GDScript.
- Confirm: `predictionErrorPx` ↓, `correctionPx` ↓ (esp. jitter-heavy).
- Wire: ~3× input payload (still tiny).

## 6. Correction tuning sweep

`CORRECTION_HALF_LIFE := 0.08` and `HARD_SNAP_DIST := 64` are guesses. A
parameter matrix (half-life 0.05–0.3s, snap 32–128px) may find a smoother
operating point, especially interacting with #3.

- Pure Tier-1 sweep via a scenario/CLI knob; no wire change. Promote only
  with Tier-2 confirmation (feel is the ultimate judge here).
- Confirm: `correctionPx` p95 and `jerkRms` ↓ without `predictionErrorPx` ↑.

## 7. Snapshot delta/binary encoding

Full player array every tick as JSON. At 3 players it's ~440B/tick
(~9KB/s/client); fine now, but a bandwidth win compounds with more players.
Not a jitter fix — do only after the smoothness items.

## 8. Lag compensation (server-side rewind)

Collisions resolve at present-tick positions; high-ping players die to
things they never saw. Fairness feature, not smoothness — needs server
world-state history ring buffer. Last.
