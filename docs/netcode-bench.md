# Netcode Benchmark Harness

A two-tier, repeatable benchmark for the game's netcode: it quantifies
desync, smoothness, and packet health under simulated latency so netcode
changes can be judged by scorecards instead of eyeballs. Built for the
netcode R&D loop (`.claude/skills/netcode-rd`), useful for any perf work.

## Quick start

```bash
bun run bench:netcode                          # baseline-3p-100ms, 1 run
bun run bench:netcode -- --scenario control-0ms --duration 15
bun run bench:netcode -- --all --runs 3        # full sweep, median-of-3 (~22 min)
bun run bench:compare bench-baselines/baseline-3p-100ms.json bench-results/baseline-3p-100ms/<card>.json
```

Scorecards land in `bench-results/<scenario>/` (gitignored). Reference
baselines live in `bench-baselines/` (committed — regenerate deliberately
when a netcode improvement lands on main).

## Architecture

**Tier 1 (headless, the R&D workhorse)** — one Node process runs:

- the real API server (integration-test bootstrap: PGlite, dev-credential
  auth, production auth hooks) with the game loop RUNNING;
- a ground-truth recorder on `GameLoop.onTick` — exact authoritative
  positions, tick duration, snapshot bytes per tick;
- a seeded TCP latency proxy per bot (`packages/bench/src/proxy.ts`) — base
  delay + jitter per direction. "Loss" is modeled honestly for TCP as
  `stall` (paused reads → real backpressure → engine.io's `.volatile.emit`
  genuinely drops snapshots);
- bot clients (`apps/api/src/bench/bot/`) speaking the production wire
  protocol and running 1:1 TS ports of the Godot netcode:
  `prediction.ts` ≡ `local_snake.gd`, `interpolation.ts` ≡ `remote_snake.gd`.
  Bots render at ~60Hz and record every rendered frame.

Everything shares one machine clock, so cross-client comparisons are exact.

**Tier 2 (real browsers, the truth lane)** — Playwright drives Chromium
running the real web app + Godot WASM with `?bench=1`; a Godot telemetry
autoload streams rendered positions/FPS/corrections to the page, the same
latency proxy sits in front of each browser, and the same scorecard comes
out (`apps/bench-web`). Use it to validate Tier-1 winners — it measures the
real render pipeline, including WASM frame pacing.

## Reading a scorecard

| Metric                                   | Meaning                                                                                                                | Healthy shape                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `divergence.remoteVsRemotePx`            | Same entity, same instant, two clients that BOTH see it remotely. The purest desync signal.                            | ~0–2px. Growth = inconsistent interpolation clocks.                        |
| `divergence.ownVsRemotePx`               | Owner's predicted-now view vs another client's delayed view.                                                           | ≈ (RTT + interp delay) × speed. Dropping it means cutting perceived delay. |
| `perEntity.renderLatencyMs`              | Lag that best aligns a client's render with the server track (staleness incl. the intentional interp delay).           | ~transport + 125ms for remotes; ~0 for the local snake.                    |
| `perEntity.shapeErrorPx`                 | Residual error after removing that lag — trajectory fidelity.                                                          | Low single digits. Spikes = warping/snapping.                              |
| `predictionErrorPx`                      | Local snake raw error vs server (lag 0) — prediction accuracy.                                                         | < ~15px under 100ms RTT.                                                   |
| `smoothness.teleportsPerMin`             | Frame-to-frame displacement beyond any legal speed (deaths masked).                                                    | 0. Any value is user-visible popping.                                      |
| `smoothness.jerkRms`                     | RMS frame-to-frame acceleration of rendered motion.                                                                    | Relative metric — compare across runs, not absolutely.                     |
| `hardSnapsPerMin` / `correctionPx`       | Reconciliation events on the local snake.                                                                              | Rare / small.                                                              |
| `packet.gapRate`                         | Fraction of ticks missed between consecutive snapshot arrivals (tick-numbered, so volatile drops are exactly counted). | ~0 except bursty scenarios.                                                |
| `packet.inputAckRttMs`                   | Input send → first snapshot acking it.                                                                                 | RTT + up-to-one-tick alignment.                                            |
| `server.tickDurMs` / `effectiveTickRate` | Sim cost and loop health.                                                                                              | ≪ 50ms / 20Hz.                                                             |

Aggregated runs (`--runs 3`) report element-wise medians plus `runVariance`
(max−min of headline metrics across runs). `bench:compare` treats deltas
inside the noise band as `within-noise` — don't ship a "win" that lives there.

## Scenarios

See `packages/bench/src/scenarios.ts`. `control-0ms` is the harness
self-check: run it after ANY harness change — expect ~0 divergence, 0
teleports, interArrival ≈ 50ms. The others put ~75–150ms RTT with different
jitter shapes (normal wobble, spikes, backpressure stalls, asymmetric peers)
under wandering or deliberately-crossing bots.

## Comparing (the keep/discard gate)

```bash
bun run bench:compare <baseline.json> <candidate.json>
```

All headline metrics are lower-is-better. Verdicts: `improved`, `ok` (below
absolute floor), `within-noise` (below measured run spread), `warn` (>5%),
`fail` (>15%). Exit code 1 on any `fail` — CI/loop friendly. Thresholds are
in `packages/bench/src/compare.ts` (`DEFAULT_THRESHOLDS`); pass
`--thresholds file.json` to override.

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

## Extending

- New scenario: add to `SCENARIOS` (seed, duration, per-bot net profiles,
  behaviors). Keep `npcCount: 0` unless NPC load is the point.
- New metric: compute it in `packages/bench/src/metrics/`, add to the
  scorecard type (bump `schemaVersion` if the shape changes), and register
  it in `headlineMetrics()` if it should gate comparisons.
- New netcode variant: implement in `apps/api/src/bench/bot/prediction.ts` /
  `interpolation.ts` (server changes in `services/game/`), benchmark, and
  only port winners to GDScript. Keep the ports and `local_snake.gd` /
  `remote_snake.gd` in lockstep otherwise.
