# Netcode R&D — Hypothesis Backlog

Prioritized by suspected impact on the observed rubberbanding/jitter between
real devices. Each entry names the change, where it lives, what scorecard
movement would confirm it, and its wire-format impact. Work top-down; the
loop (`/netcode-rd`) picks the first hypothesis not yet in the LEDGER.

## 1. Global world clock (shared tick estimator) — SHIPPED

Resolved 2026-08-01 and recorded KEPT in `LEDGER.md`. Kept here for the
record; do not pick it up again.

Every `RemoteSnake` used to keep its own `_tick_est`, nudged 5% per render
frame toward its freshest snapshot, so two remotes on one screen could render
at slightly different world times and the nudge factor was frame-rate
dependent. Every snake now reads one shared clock
(`remote_snake.gd` calls `Game.render_tick()`), using the frame-rate
independent form `est += (target − est) * (1 − exp(−dt/τ))` with τ=0.3s.

- Result: `jerkRms` 1293→1129 (−12.7%) on fps-varying-3p; other scenarios
  sub-floor. See the 2026-08-01 LEDGER entry.

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

## 4b. Server-coordinated uniform interpolation delay

Per-client adaptive delay (tried in iteration 2, discarded) desyncs clients
on unequal links. The server sees per-socket backpressure/drop rates and
could broadcast a single recommended delay for the room (slow-moving, e.g.
p95 of observed client jitter envelopes) — adaptivity without breaking
cross-client alignment. Only worth testing on mixed-link scenarios.

## 5. Input redundancy — SHIPPED

Resolved 2026-10-23 (the netcode pack's G1) and recorded KEPT in
`LEDGER.md`. Kept here for the record; do not pick it up again.

Each input frame used to be sent once and applied latest-wins, so a late
frame stretched the previous intent over extra ticks and clumped frames
collapsed into one step: reconciliation corrected about one movement step.
Each message now carries the last four frames (`{ frames }`), the server
steps one frame a tick from a per-snake queue (`InputQueue`), and a tick
without a frame coasts and stands in for the late frame.

- Result: `correctionPx` p95 9 → 0.1 px on most clients, `jerkRms` −18…−65%
  where it moved; see the 2026-10-23 LEDGER entry, with the dead ends.

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

## 8b. Lag compensation without rewind: latency-dilated action timing

For any action with a windup and a recovery (a cast, a charge, a dash with
a startup), the server shortens the actor's windup by that player's one-way
latency (ack RTT / 2, capped at 200 ms) and lengthens the recovery by the
same amount. The action lands when the actor expected it to, the total
animation keeps its length, so other clients see the normal animation and
the actor gains no tempo. No world-state history, no re-simulation of other
players: one subtraction when the action starts. Source: Project B (studied
2026-10-22) applies dil = min(0.2, ping / 1000). Not applicable to the snake
world today (direction and boost have no windup); applies the day a fork
adds abilities. Measure with ownVsRemotePx around the action and a new
actionLandedLateMs (the actor's expected landing tick against the server's).
