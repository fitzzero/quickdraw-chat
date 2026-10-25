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

## 3. Adaptive interpolation delay — SHIPPED

Resolved 2026-10-23 (the netcode pack's G3) and recorded KEPT in
`LEDGER.md`. Kept here for the record; do not pick it up again.

`INTERP_DELAY_TICKS := 2.5` was fixed, which wasted ~50ms of perceived
delay on clean links. Each client now renders as far behind as its own
arrivals need (`PlaybackDelay`): mean + 3σ of the time between them (about
the last 10 s) plus a frame, clamped to 1.5–6 ticks, reached by running the
render clock 5% fast or slow, at most 2 ticks past the newest snapshot.

- Result: remotes render 40–50 ms sooner on clean and mildly jittery
  links (`renderLatencyMs` −15…−35%), jitter-heavy-3p holds, and
  bursty-3p's stalled clients render further behind so their buffers stop
  running dry. `jerkRms` −10…−60%, teleports 0. The accepted cost: clients
  on unequal or jittery links render one snake at different moments
  (`remoteVsRemotePx` p50 up to 17 px on bursty-3p), and `shapeErrorPx`
  rises 1–2 px where the delay follows the link. See the 2026-10-23 LEDGER
  entry.

## 4. Velocity-aware (Hermite) interpolation

Remotes lerp positions and IGNORE the `dx,dy` velocity already on the wire.
Linear segments turn 20Hz samples of a curving snake into a polyline —
visible direction popping at segment boundaries.

- Change: cubic Hermite between bracketing snaps using `dir × speed` as
  tangents (speed from boost flag + tunables).
- Confirm: `shapeErrorPx` ↓, `jerkRms` ↓ at unchanged `renderLatencyMs`.
- Wire: none.

## 4b. Server-coordinated uniform interpolation delay — CLOSED

Closed 2026-10-23 untested: the user chose per-client delays (2026-10-22),
accepting cross-client divergence on unequal links for a lower delay on
good ones, and #3 shipped them. One delay for the room would hold every
client at its worst link's. Kept here for the record.

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

- Result: `correctionPx` p95 at most 0.8 px on every client, from 9–16 px;
  `jerkRms` −17…−43% where it moved. See the 2026-10-23 LEDGER entry, with
  the dead ends.
- Amended 2026-10-24: the queue's "owed" coast (a stood-in frame that came
  alone was stepped anyway, a later frame skipped to pay for it) moved the
  ack and the steps apart by one each way, about once a second for a
  player on the tick boundary, which the live game showed as a surge and a
  stall; p95 hid it. Every coast now stands in, and a late frame steers
  the next tick instead of stepping. See the 2026-10-24 LEDGER entry and
  the must-be-zero `stepAckMismatchPerMin`.

## 6. Correction tuning sweep

`CORRECTION_HALF_LIFE := 0.08` and `HARD_SNAP_DIST := 64` are guesses. A
parameter matrix (half-life 0.05–0.3s, snap 32–128px) may find a smoother
operating point, especially interacting with #3.

- Pure Tier-1 sweep via a scenario/CLI knob; no wire change. Promote only
  with Tier-2 confirmation (feel is the ultimate judge here).
- Confirm: `correctionPx` p95 and `jerkRms` ↓ without `predictionErrorPx` ↑.

## 7. Snapshot delta/binary encoding — SHIPPED

Resolved 2026-10-23 (the netcode pack's G4) and recorded KEPT in
`LEDGER.md`. Kept here for the record; do not pick it up again.

The full player array went every tick as JSON: about 110 B a player.
Each snapshot is now packed (`game/snapshotCodec.ts`): 23 B a player, a
player named by an index into the stream's id table, base64 in the stream
item (`{ b }`), since the Godot client reads text frames only. A binary
attachment would save the base64's third; it needs the Socket.IO binary
format in GDScript.

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

## 9. A fair link with the players' jitter

A party's fair link lags the host's own user's links by the players' median
one-way trip, with no jitter (`settleFairLink`, `setLag({ ms })`). The host's
own user then plays the others back about 20 ms sooner than its players do
(`party-3p-lossy`: 135 ms against 155–160 ms), since a jitter-free link needs
a smaller playback buffer. Lag its links with the players' median jitter
too (`setLag({ ms, jitter })`, the jitter from each link's clock), so its
playback delay matches theirs. Measure with `party-3p-lossy`: the host's
own user's renderLatencyMs against the players', and remoteVsRemotePx p95
(8.4 px, against 3.0 px when the host's own user has a player's link).
