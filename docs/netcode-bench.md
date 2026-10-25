# Netcode Benchmark Harness

A two-tier, repeatable benchmark for the game's netcode: it quantifies
desync, smoothness, and packet health under simulated latency so netcode
changes can be judged by scorecards instead of eyeballs. Built for the
netcode R&D loop (`.claude/skills/netcode-rd`), useful for any perf work.

## Quick start

```bash
bun run bench:netcode                          # baseline-3p-100ms, 1 run
bun run bench:netcode -- --scenario control-0ms --duration 15
bun run bench:netcode -- --all --runs 3        # full sweep, median-of-3 (~45 min)
bun run bench:compare bench-baselines/baseline-3p-100ms.json bench-results/baseline-3p-100ms/<card>.json
```

Scorecards land in `bench-results/<scenario>/` (gitignored). Reference
baselines live in `bench-baselines/` (committed — regenerate deliberately
when a netcode improvement lands on main).

## Architecture

**Tier 1 (headless, the R&D workhorse)** — one Node process runs:

- the real API server (integration-test bootstrap: PGlite, the app's own
  sign-in with development credentials, the game service's own
  `onRoomLeave`) with the game loop RUNNING;
- a ground-truth recorder on `GameLoop.onTick` — exact authoritative
  positions, tick duration, snapshot bytes per tick;
- a seeded TCP latency proxy per bot (`packages/bench/src/proxy.ts`) — base
  delay + jitter per direction. "Loss" is modeled honestly for TCP as
  `stall` (paused reads → real backpressure → the volatile world stream
  genuinely drops snapshots);
- bot clients (`apps/api/src/bench/bot/`) speaking the production wire,
  quickdraw protocol v5, the way the Godot client does: `qd:stream:sub` of
  the `world` stream, then `joinGame`/`watchWorld` (`qd:call`, which puts the
  socket in the world's room), input as `qd:ch` (volatile, never answered),
  snapshots as `qd:stream` frames and deaths as `qd:event` — and running 1:1
  TS ports of the Godot netcode: `prediction.ts` ≡ `local_snake.gd`,
  `interpolation.ts` ≡ `remote_snake.gd`, `world-clock.ts` ≡ `game.gd`'s
  clock, `food.ts` ≡ `main.gd`'s food (`_apply_food`, `_on_keyframe`). Bots
  render at ~60Hz and record every rendered frame.

Everything shares one machine clock, so cross-client comparisons are exact.

**Tier 2 (real browsers, the truth lane)** — Playwright drives Chromium
running the real web app + Godot WASM with `?bench=1`; a Godot telemetry
autoload streams rendered positions/FPS/corrections to the page, the same
latency proxy sits in front of each browser, and the same scorecard comes
out (`apps/bench-web`). Use it to validate Tier-1 winners — it measures the
real render pipeline, including WASM frame pacing.

## Reading a scorecard

| Metric                                   | Meaning                                                                                                                  | Healthy shape                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `divergence.remoteVsRemotePx`            | Same entity, same instant, two clients that BOTH see it remotely. The purest desync signal.                              | ~0–1px on equal links; unequal ones: speed × the delays' gap (10–20px).    |
| `divergence.ownVsRemotePx`               | Owner's predicted-now view vs another client's delayed view.                                                             | ≈ (RTT + interp delay) × speed. Dropping it means cutting perceived delay. |
| `perEntity.renderLatencyMs`              | Lag that best aligns a client's render with the server track (staleness incl. the intentional interp delay).             | ~transport + the playback delay (75–300ms) for remotes; ~0 for the local.  |
| `perEntity.shapeErrorPx`                 | Residual error after removing that lag — trajectory fidelity.                                                            | Low single digits. Spikes = warping/snapping.                              |
| `predictionErrorPx`                      | Local snake raw error vs server (lag 0) — prediction accuracy.                                                           | < ~15px under 100ms RTT.                                                   |
| `smoothness.teleportsPerMin`             | Frame-to-frame displacement beyond any legal speed (deaths masked).                                                      | 0. Any value is user-visible popping.                                      |
| `smoothness.jerkRms`                     | RMS frame-to-frame acceleration of rendered motion.                                                                      | Relative metric — compare across runs, not absolutely.                     |
| `hardSnapsPerMin` / `correctionPx`       | Reconciliation events on the local snake.                                                                                | Rare / small.                                                              |
| `smoothness.stepCorrectionsPerMin`       | Per client: corrections of a whole movement step (≥ 8 px), a surge or a stall the player sees; the worst client gates.   | 0; at most one a minute from a stood-in frame's change of intent.          |
| `packet.gapRate`                         | Fraction of ticks missed between consecutive snapshot arrivals (tick-numbered, so volatile drops are exactly counted).   | ~0 except bursty scenarios.                                                |
| `packet.inputAckRttMs`                   | Input send → first snapshot acking it.                                                                                   | RTT + up-to-one-tick alignment.                                            |
| `server.tickDurMs` / `effectiveTickRate` | Sim cost and loop health.                                                                                                | ≪ 50ms / 20Hz.                                                             |
| `server.snapshotBytes`                   | The stream item's JSON: the packed snapshot, base64 in `{ b }`. On the wire each `qd:stream` frame adds 59 bytes.        | 23 B a player (31 in base64); add fields consciously.                      |
| `server.inputQueue`                      | Server's view of client clocks: depth p95, coasted and multi-step tick rates, depth trend, step/ack mismatches a minute. | depth 0–1, multi-step < 5%, trend ~0, mismatches 0 (must be; see below).   |
| `foodMismatchAtEnd` / `foodResyncs`      | Per client: food ids held at the end that differ from the server's at that tick (the worst gates); keyframes asked.      | 0 / 0. Tier 1 only (Godot reports none); check:godot checks Godot's.       |

Aggregated runs (`--runs 3`) report element-wise medians plus `runVariance`
(max−min of headline metrics across runs). `bench:compare` treats deltas
inside the noise band as `within-noise` — don't ship a "win" that lives there.

## The real client: `check:godot`

The bots stand in for the Godot client; `bun run check:godot` runs the real
one: two headless copies of `apps/game/godot` (`test/session.gd`) against
the same bench server, checking a whole session (join, each sees the other
move, a death, the leaderboard, each holding the server's food, one that
missed a second of snapshots asking for a keyframe and the other for none,
an API restart with both reconnecting). See `apps/game/README.md`.

## Scenarios

See `packages/bench/src/scenarios.ts`. `control-0ms` is the harness
self-check: run it after ANY harness change — expect ~0 divergence, 0
teleports, interArrival ≈ 50ms. The others put ~75–150ms RTT with different
jitter shapes (normal wobble, spikes, backpressure stalls, asymmetric peers)
under wandering or deliberately-crossing bots. `mixed-3p` puts three unequal
links in one world (a clean ~40ms RTT, a wide wobble, spikes): what each
client's own interpolation delay costs the others (`remoteVsRemotePx`). `drift-fast-client` and
`drift-slow-client` (120 s each) give one bot a tick clock 1% fast or slow
(`BotSpec.clockScale`, which scales only its predictor's clock): the input
queue must hold the fast one's depth (`depthTrend` ~0, no ratchet toward the
cap) and coast the slow one for every frame it misses, refusing the late
frame and steering by it on the next tick.

A coasted tick (`starvedRate`) is cheap: the coast stands in for the late
frame, so the snake still moves once a tick, the ack counts the coast as
that frame, and the frame, when it arrives, steers the next tick instead of
stepping; the client corrects only that frame's change of intent. A client
whose frames land within a render frame (about 17 ms) of the server's tick
coasted often before the clients re-phased (14–28 % of its ticks in a real
browser): the tick's snapshot after a late frame steered, or after the
client numbered past a frame a coast stood in for, says `late`, and a
client that hears it on a fifth of its snapshots (averaged over about a
second) moves its frame clock half a tick earlier, gained over a quarter
second, at most once per half second (`inputQueue.nudgesPerMin` per
client). Jitter alone stays under that rate while its spread is under
about half a tick, so it does not walk the phase around the tick; on a
link jittery past that, watch `nudgesPerMin` (nudges only move frames
earlier, and only the queue's hold drains a frame a whole tick early).
So `starvedRate` now means jitter, a stall or a slow clock, not a phase:
a few percent on a clean link.
What is never cheap is the ack parting from the steps
(`stepAckMismatchPerMin`): the queue's first version let a coast be "owed"
when the stood-in frame came alone, stepped that frame anyway and skipped a
later one to pay for it, and a player on the tick boundary got a whole-step
correction each way about once a second (the live game on 2026-10-24).
`correctionPx` p95 never saw it, which is why that metric must be zero and
`stepCorrectionsPerMin` counts the corrections a player feels.

`party-3p-lossy` and `party-3p-unfair` are parties (host mode,
`Scenario.party`): no server. A host in process runs the party's world
(`PartyWorld`, the shared sim and loop; its ticks are the ground truth), and
each bot plays over a loopback link to it (core's `createLoopbackPeerLink`):
50 ms each way plus up to 15 ms, 5% of `fast` messages lost, so
`packet.gapRate` measures real loss. The bots and the host exchange the
app's payloads over the ends (`apps/api/src/bench/party.ts`: input and raw
snapshots on `fast`, the party's events and keyframes on `rel`); host
mode's own framing is `check:godot`'s and the browser's to check. The bot
`host` is the host's own user, whose game runs on the host's machine: it
plays over a link no network slows (0 ms, no loss). In `party-3p-lossy`
the harness lags that link as the host's page does, with the page's own
`settleFairLink`: every 5 s (the first at 2.5 s, before the measured
window) by the other players' median one-way trip, as their links' clocks
measure it. In `party-3p-unfair` it never does: the advantage the fair
link removes. A party's `server.snapshotBytes` is the raw snapshot's JSON
(its host sends `WorldSnapshot`s), not comparable with the server's
packed items. The scorecard's `party` line (`Scorecard.party`, reported,
not compared; `n/a` for what no client measured) sets the host's own user
against the median of the other players: `inputAckRttMs` p50 and
`predictionErrorPx` p95. A bot's ack time includes the wait for the host's
next tick, which depends on where its input clock steps against the host's
tick grid: bots at different phases differ by up to a tick on equal links.
So every party bot starts its clock 10 ms after a host tick
(`INPUT_PHASE_MS` in `party.ts`), and the party line compares links, not
join times. A respawn starts the clock again at the bot's first snapshot,
as in Godot, so from then on its link sets the phase. Prediction error (the
own snake against the host's at the same instant) grows with the same trip
and wait: the party's 5% loss adds coasted ticks, not prediction error (the
LEDGER's G6 entry has the A/B).

## Comparing (the keep/discard gate)

```bash
bun run bench:compare <baseline.json> <candidate.json>
```

All headline metrics are lower-is-better. Verdicts: `improved`, `ok` (below
absolute floor), `within-noise` (below measured run spread), `warn` (>5%),
`fail` (>15%). Exit code 1 on any `fail` — CI/loop friendly. Thresholds are
in `packages/bench/src/compare.ts` (`DEFAULT_THRESHOLDS`); pass
`--thresholds file.json` to override. `food.mismatchAtEnd` (the most food
any client ended up differing from the server on) must be 0 in every run
(`MUST_BE_ZERO`, judged on an aggregated card's `runWorst`, each headline
metric's worst run): any other value fails, whatever the baseline and the
noise, and so does a candidate without it once the baseline has it.

`bench-baselines/thresholds/` holds the thresholds a change that moved
metrics on purpose was judged with, each saying what it accepts and
against which baselines: `g3-adaptive-delay.json`, the adaptive delay
against the baselines before it; `g1b-stand-in.json`, the input-queue fix
against `g4-final`; `len-tenths.json`, the float32 length against
`g1b-stand-in`, on another machine.

## Honest limits

- Wall-clock runs are not bit-deterministic (OS timers, TCP scheduling).
  Seeds fix the sampled delays/behaviors; median-of-3 + `runVariance` handle
  the rest. Compare against the noise band, not raw deltas.
- The proxy cannot reorder or truly drop TCP data; jitter manifests as
  clumping and `stall` as drop-inducing backpressure — which matches what
  real WebSocket traffic experiences.
- Tier-1 bots model the Godot client's netcode, not its renderer. Godot-side
  frame pacing, WASM GC pauses, and draw cost only show up in Tier 2.
- The remote interpolator's convergence is frame-rate dependent (per-frame
  nudge); bots must hold ~60fps — `effectiveFps` in the scorecard guards this.

## Tests

`bun run --filter @project/bench test` runs the metric unit tests
(`packages/bench/src/metrics/metrics.test.ts`); `bun run test` at the root
includes them.

## Extending

- New scenario: add to `SCENARIOS` (seed, duration, per-bot net profiles,
  behaviors). Keep `npcCount: 0` unless NPC load is the point.
- New metric: compute it in `packages/bench/src/metrics/`, add to the
  scorecard type (bump `schemaVersion` if the shape changes), and register
  it in `headlineMetrics()` if it should gate comparisons.
- New netcode variant: implement in `apps/api/src/bench/bot/prediction.ts` /
  `interpolation.ts` (server changes in `packages/shared/src/game/`, the sim
  and its loop, or `apps/api/src/services/game/`), benchmark, and
  only port winners to GDScript. Keep the ports and `local_snake.gd` /
  `remote_snake.gd` in lockstep otherwise.
