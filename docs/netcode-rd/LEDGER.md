# Netcode R&D — Ledger

One entry per tested hypothesis, newest first. The loop appends here after
every benchmark verdict; keep entries even for losses — they are the map of
dead ends.

Template:

```
## <date> — H<n>: <short name>   [KEPT | DISCARDED]
- Branch: netcode/<slug> (merged into netcode/rd at <sha> | deleted)
- Scenarios: baseline Δ…, jitter-heavy Δ…, encounter Δ…
- Headline: remoteVsRemote p95 X→Y px, teleports/min X→Y, …
- Notes: what happened, surprises, follow-ups spawned.
```

---

## 2026-10-23 — H5: Input queue and redundant frames (the pack's G1) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  a429eea. The variants tried are kept on `wip/g1-input-queue` (F 0749d3b,
  D ed033e4, A 822c3c5, H2 f389b59).
- Change: the input channel carries `{ frames }`, the newest last with up
  to three unacknowledged ones before it. Each human snake queues its
  frames once by seq (`InputQueue`) and steps one a tick, so
  `PlayerSnap.ack` names the last frame the server's state holds. A tick
  without a frame coasts on the last intent and stands in for the late
  frame, which is ignored when it arrives. The loop ticks on an exact
  20 Hz grid (`setInterval` ran at 19.94 Hz).
- Scenarios (the sweep, `--all --runs 3`, against the `core-5.1.3`
  baselines): no `fail`, no `warn`. jerkRms asym-2p −65%, jitter-heavy-3p
  −40%, encounter-3p-100ms −34%, fps-varying-3p −19%, spectator-plus-2p
  −18%, the rest within noise. inputAckRttMs p95 −5…−14% or within noise.
- Headline: correctionPx p95 9 px (one movement step) → 0.1 px on most
  clients; jitter-heavy-3p 9/16/16 → 0.3/0.6/6.9 px. teleportsPerMin 0
  everywhere.
- The plan's queue (A: full credit, up to three frames a tick, a starved
  tick skipped) fails its own gate: corrections 9 → 0.1 px, but jerkRms
  +202…+225% on the three-player scenarios. A client steps its 20 Hz sim
  from a 60 fps loop, so its frames leave with up to ~17 ms of jitter. A
  client whose frames reach the server within that of the tick (about one
  in three, by the chance of its connect time) flips them between ticks:
  stepping what arrived gives "2, 0", which every viewer's interpolation
  shows as a pause and a double step.
- Dead ends, one run each against the same baselines:
  - A plus the exact loop: jerk +65% / +188% / +151% (baseline-3p-100ms /
    jitter-heavy-3p / control-0ms).
  - B (a second frame in a tick only from a backlog): input ack +44 ms.
  - C (B plus coasting, the late frame skipped): ack +44 ms; the 19.94 Hz
    loop kept a frame queued for good.
  - D (C plus the exact loop and a 2 s drain): control-0ms ack +15%,
    ownVsRemotePx +24%; a slow clock chained coasts into skipped frames.
  - F (coasting; a frame that waited a tick steps with the next): jerk
    +49% / +90% (baseline-3p-100ms / control-0ms).
  - G40 (D's rules, a coasted step paid only by a frame that arrives with
    another): corrections 0.1 px, but control-0ms ack +19%, ownVsRemotePx
    +27%: the client at the tick keeps a frame held.
  - H (a coast stands in for the late frame): the best jitter-heavy-3p,
    but it switched between coasting and holding a frame and double-
    stepped: baseline-3p-100ms jerk +38%.
- What held: every server-only rule makes a client at the tick pay one of
  input latency (a held frame), stutter (the skip) or a correction (a
  coast). H2's coast stands in for the late frame, so the correction is
  only that frame's change of intent; a stood-in frame that arrives with
  nothing after it (a slow clock), or a fifth coast in a row, makes the
  next coast owed instead (a frame that arrives with another pays it;
  the debt expires after four ticks); a second frame steps in a tick only
  from a backlog or after a frame waited 10 ticks.
- tickDurMs: every single run before the sweep measured 0.21 → 0.30 ms
  p95, G1 or not. The unchanged pre-G1 code measured the same in the same
  hour (control-0ms 0.26, baseline-3p-100ms 0.35 ms p95), and the sim's
  step alone costs 0.026 ms p50 with or without G1. The machine moved it;
  in the sweep it was back to 0.17–0.24 ms.
- Bounds the plan set for the skip design: control-0ms `starvedRate` 1.00%
  (bound < 0.5%; bot-a, at the tick, coasted 3%); drift-slow-client 2.11%,
  6.2% for the slow client (bound 0.5–2%). A coasted tick is cheap: the
  snake moves and nothing stutters. `multiStepRate` stays under 0.4%
  everywhere (bound < 5%). drift-fast-client: depth p95 1, trend 0.14,
  starved 0.15% (bounds met).
- predictionErrorPx p95: jitter-heavy-3p 12.3/17.7/17.8 → 10.9/7.4/10.4;
  baseline-3p-100ms 10.0/13.0/12.2 → 4.5/11.2/15.4. It is mostly the
  client's one-tick lead; with the exact loop a client's phase holds for a
  whole run, so it spreads per client.
- `server.inputQueue.depthP95` joins the headline metrics with a floor of
  one frame, not the planned 0.05: a client's queue holds 0 or 1 by its
  phase, and a ratchet grows by more.
- Baselines: all ten scenarios are this sweep's (label `g1-queue`),
  drift-fast-client and drift-slow-client new.

## 2026-10-23 — Re-baseline: quickdraw-core 5.1.3 on the pod machine [BASELINE]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at 7845843
  (the netcode pack's first child: core, lint and skills 5.1.2 → 5.1.3). No
  netcode change; this entry resets the baselines so the pack's first
  verdict (G1, the input queue) is judged against the new core on the
  machine that will judge it.
- Scenarios (the sweep, `--all --runs 3`, against the committed baselines):
  every scenario but `control-0ms` fails on one metric only,
  `server.tickDurMs.p95`: 0.05–0.08 ms → 0.15–0.24 ms (baseline-3p-100ms
  0.05 → 0.21). Nothing else fails or warns. `control-0ms`, `asym-2p` and
  `spectator-plus-2p` improve a lot (jerkRms −29…−40%, renderLatency
  −12…−17%, remoteVsRemote p95 −83…−88%): their baseline files were last
  written before H1/H2/H3b, which the two regenerations of 2026-08-01 did
  not rewrite.
- Attribution (same machine, same code, baseline-3p-100ms, 3 runs):
  5.1.2 and 5.1.3 measure the same (`tickDurMs` p95 0.208 against
  0.206 ms, every headline metric ok or within noise). The tick's rise is
  this machine's: the pure sim step costs about 0.2 ms p95 here, against
  0.05 on the machine of 2026-08-01. Not the core's.
- Reference numbers on the new baselines (pre-G1): `correctionPx` p95 is
  9.0 px on most clients, one movement step (180 px/s × 50 ms), 16 px on
  jitter-heavy; `predictionErrorPx` p95 6–18 px; the server ticks at
  19.95 Hz, so a client stepping 20 times a second by its own clock runs
  ahead of it now and then; a 3-player snapshot is 457 B p95, each player
  about 112 B of it.
- Baselines: all eight regenerated from this sweep, label `core-5.1.3`.

---

## 2026-08-01 — Iteration 3: GDScript port of H1+H2+H3b + Tier-2 validation [KEPT]

- Branch: netcode/godot-port (merged into netcode/rd). TS bot netcode
  unchanged — this pass ships the kept hypotheses to the real client.
- Port: world clock into game.gd (timestamp-anchored, min-delay filter,
  slew-limited; fallback nudge when the server sends no `t`);
  remote_snake.gd drops its per-entity estimator, renders on
  Game.render_tick(), coasts to a stop on underrun, and glides through
  buffer-refill jumps. WASM re-exported.
- Tier-2 (headless, baseline-3p-100ms), post-port vs old client:
  remoteVsRemote divergence p50/p95 0.6/2.5 → 0.3/1.4px (−50/−44%), remote
  shapeError p95 ~3.0 → ~2.0px, renderLatency 235 → 205ms. jerkRms deltas
  proved to be machine-load noise: a same-session pre-port control run
  matched post-port (1800–2100) — single-run headless SwiftShader jerk is
  not comparable across sessions; only within-session A/B counts.
- Bug caught by Tier-2 that Tier-1 could not see: first port stored clock
  samples in Vector2 — Godot Vector2 is FLOAT32, quantizing epoch-ms delay
  deltas to ~131s and garbaging the min-delay anchor (remotes rendered with
  zero delay, jerk 6900). Fixed with PackedFloat64Array. Rule: never put
  epoch-ms values in Vector2/3 in GDScript.

---

## 2026-08-01 — H2+H3b: Send-timestamp clock sync + graceful stall recovery [KEPT]

- Branch: netcode/stall-glide (H2 netcode/snapshot-timestamps + H3b; merged into netcode/rd)
- Scenarios (vs post-H1 baselines, 3 runs each): ALL FIVE PASS.
  remoteVsRemote divergence p95: baseline 0.78→0.05, jitter 3.81→0.12,
  encounter 0.70→0.05, fps-varying 0.93→0.08, bursty 12.65→1.06 (−91…−99%).
  jerkRms −19…−42% (bursty within-noise). shapeError p95 up to −56%.
  renderLatency −12…−15% everywhere (~17ms estimator lag eliminated).
- What shipped: (a) `WorldSnapshot.t` send-time stamp (additive; loop stamps
  at emit, sim stays pure); (b) WorldClock anchors on 4s rolling min of
  (arrival−send), free-runs on the client clock between snapshots, 2 ticks/s
  slew — arrival jitter no longer wobbles the render timeline; (c) underrun
  extrapolation coasts to a stop (no freeze) and buffer-refill jumps fold
  into a 100ms-half-life render glide — stalls recover smoothly. Interp
  delay stays uniform 2.5 ticks.
- Dead end recorded: per-client ADAPTIVE delay (naive H3, commit a677e65's
  successor, discarded) — fixed stall jerk but structurally desyncs clients
  on unequal links (each converges to a different timeline offset; bursty
  remoteVsRemote p50 hit 38px). Any per-client delay divergence breaks
  cross-client alignment → queued new hypothesis: server-coordinated uniform
  delay (server observes per-socket backpressure and can suggest one delay
  for the room).
- GDScript port pending (with H1): remote_snake.gd/game.gd — shared clock,
  snapshot `t` consumption, soft-stop + glide. Tier-2 validation after.

---

## 2026-08-01 — H1: Global world clock [KEPT]

- Branch: netcode/global-world-clock (merged into netcode/rd)
- Scenarios (vs cfb4f6c baselines, 3 runs each): baseline-3p-100ms PASS
  (all deltas sub-floor), jitter-heavy-3p PASS (remoteVsRemote p95
  4.14→3.98px), encounter-3p-100ms PASS (~0 deltas), fps-varying-3p PASS
  with **jerkRms 1293→1129 (−12.7%, improved, ~3× the run-noise band)**.
- Headline: at steady 60fps the per-entity estimators are near-identical to
  a global clock (all entities share one arrival stream), so deltas are ~0.
  The win appears exactly where the hypothesis predicted: fluctuating frame
  rate, where the baseline's 5%-per-frame nudge changes its effective time
  constant. Fixed via shared WorldClock with τ=0.3s exponential form.
- Harness note: this iteration ADDED `fps-varying-3p` (oscillating 30–90fps
  render clocks, out of phase) because steady-fps bots were structurally
  blind to this hypothesis — committed separately on netcode/rd (e57b0de)
  with its own baseline before judging.
- GDScript port pending (remote_snake.gd estimator → shared clock in
  game.gd; use `1 − exp(−dt/τ)` nudge). Tier-2 validation with it.

---

_(no entries yet — baselines established, loop not yet started)_
