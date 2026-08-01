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
