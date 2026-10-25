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

## 2026-10-25 — Length on the wire: the client decides boost from the server's length [KEPT]

- Branch: conveyor/netcode-seams-after-the-input-queue-fix-tbvgb1 (89d2f3b
  tenths, 4321d07 float32), the Conveyor card
  `boost-near-the-minimum-length-the-client-predicts-a-base-ste`.
- Why: `stepMovement` decides `boosting` from `len > minLength` on the
  server's fractional length, and the client replayed from `PlayerSnap.len`,
  floored on the wire. A snake boosting within one segment of the minimum
  moved 16 px a tick on the server and 9 px in its own prediction: a 7 px
  correction every tick (`correctionPx` p95 7.0 px on fps-varying-3p and
  both party scenarios in `g1b-stand-in`).
- First cut, tenths of a segment (u16): the every-tick surge went, but not
  all of it. A burn tick is 0.075 segments, so a snake boosting down to the
  minimum can hold 5.025 while the wire says 5.0, and the client predicts a
  base step where the server boosts once more: two 7 px corrections in
  about two of three boosts down to the minimum (control-0ms bot-b, 0.84
  min traced: 19 corrections of 7 px). Driving the sim and LocalPredictor
  through 200 boosts down to the minimum with a two-tick round trip: 174 to
  225 corrections of 4.5 px or more with tenths, 0 to 14 with float32 (the
  rest from lengths a float error leaves 1e-15 above the minimum).
- Change, as Logan chose on the card: `PlayerSnap.len` is the sim's length
  as a float32 (`Math.fround` in `buildSnaps`), and the packed player
  carries it as an f32 (23 bytes a player, from 21; codec version 2,
  `snapshot_decoder.gd` refuses version 1 with a warning). Deaths and the
  leaderboard stay floored.
- Scenarios (the sweep, `--all --runs 3`, label `len-tenths`, against
  `g1b-stand-in`, judged with `bench-baselines/thresholds/len-tenths.json`):
  all thirteen pass. `server.inputQueue.stepAckMismatchPerMin` 0 in every
  run. `correctionPx` p95, worst client: control-0ms 0.11 → 0.10,
  baseline-3p-100ms 0.68 → 0.12, fps-varying-3p 6.94 → 0.57,
  party-3p-lossy 7.00 → 0.67, party-3p-unfair 6.99 → 0.10.
  `stepCorrectionsPerMin` (8 px or more, worst client) falls in 10 of 13
  scenarios (control-0ms 10.8 → 2.2, party-3p-lossy 19.3 → 3.2); it rises
  on encounter-3p-100ms (5.3 → 10.6, within noise: one bot on the tick
  boundary, starved 31.9 %) and bursty-3p (0 → 1.1). `snapshotBytes` mean
  +8 B on three players (+5 %); the party's JSON snapshots +6–9 %, a
  float32 printing with many digits.
- Machine: this sweep ran on reaper1, where the tick p95 is about twice
  the baselines' (0.17–0.24 ms against 0.08–0.11); the shipped code
  (6495269) measures 0.19 ms there too. Against the shipped code on the
  same machine, control-0ms `ownVsRemotePx` p95 23.6 → 26.9 px is within
  noise (its spread 4.1), and jitter-heavy-3p `shapeErrorPx` p95 8.3 →
  7.3 px.
- Threshold: `STEP_CORRECTION_PX` stays 8 px. At 4.5 px (traced on all
  thirteen scenarios) the proxied ones show 2–15 a minute, nearly all 7 px
  and its multiples on the clients in the late regime (baseline-3p-100ms
  bot-b and bot-c, starved 15 and 28 % in the traces): a frame a coast
  stood in for that toggled boost is a boosted step against a base one.
  The input-phase card (`input-phase-a-client-whose-frames-land-just-after-the-tick-m`)
  removes that regime and judges 4.5 px again.
- Baselines: all thirteen scenarios are this sweep's (label `len-tenths`,
  at 4321d07; the traces' scorecards computed again at 8 px).

## 2026-10-24 — H5b: Every coast stands in; a late frame steers the next tick [KEPT]

- Branch: fix/input-queue-coast-stands-in (9257796 the queue, dd2caeb the
  proxy and the out-of-order guard), the Conveyor card
  `input-queue-every-coast-stands-in-for-the-late-frame-which-s`.
- Why: the live game (Cloud Run and reaper1, deployed from PR #60) surged
  and stalled about once a second. Decoding the packed snapshots of a 90 s
  guest session: the player's own `ack` stood still on 16–29 ticks a
  minute, moved by two with one step on 4–9, and by two with two steps on
  7–19. Each ack that does not count the steps is a whole movement step
  the client's replay did not predict: 9 px, 50 ms of motion, folded in
  over 80 ms as a surge or a stall. Snapshot delivery (p95 53–55 ms, no
  bunching), the tick grid (p99 52 ms) and the page's frame pacing were
  clean.
- Cause: H5's "owed" coast. A coast with nothing arrived stood in for the
  client's next frame (ack and floor up); a coast after a refused late
  frame (`arrived`) raised the ack alone, so the frame it stood for was
  queued and stepped later (ack still for a tick: +1 step) and a later
  frame skipped to pay (ack +2 for one step: −1), or the debt expired and
  the +1 stayed. A client whose frames land within jitter of the tick flips
  between the two branches; Godot's 60 Hz physics loop puts a third of real
  sessions there. `correctionPx` p95 never saw it: the events are 1–3 % of
  ticks. Driving the real `InputQueue` with synthetic arrivals (the card's
  `queue-sim.mts`): 42–44 changes of steps − ack a minute at a phase 45–49
  ms into the tick with ±3–25 ms of jitter, 8–23 a minute for a clock 0.1 %
  slow at any phase.
- Change: the ack counts the steps. `coast()` always `passed(taken + 1)`;
  `owed`, `arrived`, `payOwed` and `OWED_TICKS` are gone; `push` says
  whether it queued the frame, and `GameWorldSim.queueInputs` adopts the
  intent of a refused frame newer than the one the snake last steered by
  (`steeredSeq`), so a consistently late client is steered one tick
  behind its prediction, never a step behind it (H5's dead ends C and D
  skipped the late frame's intent too, and a slow clock lost its steering).
  The queue is driven through phases 5–49 ms, jitter 0–25 ms and drift 0
  and ±1000 ppm in its tests, asserting steps == ack after every tick: the
  H5 queue fails it 1942 times at phase 49 ms, jitter 3 ms.
- Gates added: `server.inputQueue.stepAckMismatchPerMin` from the ground
  truth (each player's ack is recorded now), must be zero;
  `smoothness.stepCorrectionsPerMin` (corrections of 8 px or more, the
  worst client), a headline metric with a floor of one a minute. The
  threshold is 8 px, not half a step: a boosted step is 16 px; a stood-in
  frame's change of intent at a sharp turn reaches a few px; and a snake
  boosting within one segment of the minimum length corrects exactly 7 px
  a step (the server decides boost from its fractional length, the client
  from the integer on the wire: a seam of its own, the card
  `boost-near-the-minimum-length-the-client-predicts-a-base-ste`),
  so the client count is not must-be-zero; the server metric is the exact
  gate.
- Browser tier (Chromium on the 144 Hz display of the desktop, 60 s each,
  the order-preserving proxy; the shipped code from a worktree at
  b32ef82): step/ack mismatches 0 in every run of the fix (3659–3706 fed
  ticks a run; the shipped code records no acks). Corrections of 7 px or
  more a minute, worst client: baseline-3p-100ms 1.0 against 3.0,
  jitter-heavy-3p 1.0 against 5.2; `correctionPx` p99 1.1–2.3 px against
  1.0–1.5; jerkRms equal within noise (11.5–17.6k against 12.4–15.9k).
  `starvedRate` 14–28 % on one client in three: the late regime (below).
- Found on the way, fixed on the branch: the latency proxy promised FIFO
  delivery but scheduled a timer per chunk, and two chunks due at the same
  millisecond fired in either order, which reordered whole WebSocket
  frames under spikes (7–44 out-of-order snapshots a minute per client on
  jitter-heavy-3p) and gave both code versions 17–109 whole-step
  corrections a minute there; one queue drained by one timer now. And the
  clients reconciled against an out-of-order snapshot (impossible over
  TCP, real on a party's unordered `fast` channel): the bots and `main.gd`
  ignore one now.
- Cost, accepted: a client whose frames land just after the tick stays
  there (the server consumes one seq a tick from its first frame on, so the
  phase is the luck of the first arrival), is refused a quarter to a third
  of its frames and steered by them one tick later: the pre-pack design's
  latency, without its constant one-step correction. The client-side
  re-phasing is the follow-up card
  `input-phase-a-client-whose-frames-land-just-after-the-tick-m`.
- Scenarios (the sweep, `--all --runs 3`, label `g1b-stand-in`, against the
  committed baselines): against the committed baselines (`g4-final`, `g6-final` for the parties):
  `server.inputQueue.stepAckMismatchPerMin` 0.00 in every scenario, worst
  run 0 everywhere. Eleven scenarios pass; two fail `fidelity.shapeErrorPx`
  p95 by 0.7–0.9 px, each on a client's OWN snake and nowhere else:
  spectator-plus-2p 3.07 → 3.80 (bot-b→bot-b 12.6 → 16.0 px) and
  party-3p-unfair 4.07 → 5.02 (host→host 0.4 → 9.7 px, on the in-process
  link). Both are the trade: a client the server steers one tick late
  (the late regime) turns one tick before the server's track does, and a
  client at a round trip under a tick now predicts one step ahead of the
  server (the stand-in consumed its next seq, it numbered past it) where
  the H5 queue had it stepping the same frame twice. Remote entities and
  the spectator hold at 0.4–0.8 px. drift-slow-client, which failed the
  same metric in the first sweep (4.4 → 7.8 px) before the clients
  numbered past a leading ack, passes (renderLatency +7.7 %, warn).
  Improved: control-0ms ownVsRemotePx p95 26.5 → 20.5 px, bursty-3p
  jerkRms −12 %, jitter-heavy-3p gapRate 0.01 → 0 and inputAckRtt p95
  −7 % (the order-preserving proxy), party-3p-lossy remoteVsRemotePx p50
  −16 %; tick p95 −44…−59 % everywhere (the machine). `starvedRate` per
  scenario, now the only late-frame path: 0.1–4 % where no client sits on
  the tick boundary, 9–31 % where one does (baseline-3p-100ms 12.7,
  jitter-heavy-3p 12.5, mixed-3p 25.7, drift-slow-client 31.0,
  party-3p-lossy 23.2). `stepCorrectionsPerMin` (8 px or more, worst
  client) 0–5 a minute on the proxied scenarios, 10–11 on the two 0 ms
  clients (control-0ms bot-a, drift-slow-client bot-a: the one surge per
  regime entry when a stand-in runs ahead of a client at 0 ms, which the
  phase card removes) and 11–19 on the party bots over their lossy,
  unordered links. `bench-baselines/thresholds/g1b-stand-in.json` raises
  the shape-error floor to 1 px for this verdict only.
- Baselines: all thirteen scenarios are this sweep's (label `g1b-stand-in`).

## 2026-10-23 — Party worlds over peer links (the pack's G6) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  3677ccf (104e037 the server half, bfa72e9 the clients, 579ebed the
  party scenarios, 940d77e, 62b437c and 3677ccf the fixes from the
  review).
- Change: a second topology on the same contract (quickdraw-core 5.1.3's
  host mode). A player's page hosts a party world (`PartyWorld`: the
  shared `GameWorldSim` and `GameLoop`, ticked by a worker) and serves it
  over peer links: WebRTC where it connects, the server's relay
  otherwise. Players send `partyInput` and read `partyWorld` (raw
  snapshots, volatile) and `partyEvents` (reliable). The fair link lags
  the host's own user's links by the other players' median one-way trip,
  at most 100 ms (`settleFairLink`, which the page and the harness share).
- Scenarios (new, `--runs 3`, at 3677ccf): `party-3p-lossy` and
  `party-3p-unfair`. Three players on loopback links to a host in
  process, 50 ms each way plus up to 15 ms, 5% of `fast` messages lost;
  the host's own user on a local link, which the harness lags as the
  page does (or not, in `party-3p-unfair`). Their cards are the first
  party baselines (label `g6-final`).
- Headline, `party-3p-lossy`: teleportsPerMin, hardSnapsPerMin and
  food.mismatchAtEnd 0 for every client; `packet.gapRate` 4.6–5.3% for
  the players (the link's 5%, measured at last; 0 for the host's own
  user, whose link loses nothing); starvedRate 3.4%. Fairness holds: the
  host's own user's `inputAckRttMs` p50 147 ms against the players'
  median 144 ms (the plan's bound: within 10 ms), `predictionErrorPx` p95
  16.4 px against 14.8 px (+11%; the bound: within 25%).
- Headline, `party-3p-unfair` (no fair link): the host's own user's ack
  p50 33 ms against 142 ms, prediction error p95 3.2 px against 16.2 px.
  That is the advantage the fair link removes. The 33 ms is the wait for
  the host's next tick, not a link.
- The fair link evens the trip, not the jitter: the host's own user's
  link has none, so it plays the others back 135 ms behind, where the
  players play everyone 155–160 ms behind. `remoteVsRemotePx` p95 is 8.4
  px (3.0 when the host's own user had a player's link). Follow-up
  hypothesis: lag the host's links with the players' jitter too.
- Prediction error p95 is 9.6–17.3 px over the four: under the plan's
  15 px for 2 of 4. An A/B without loss (all four on the same link with
  `loss: 0`, 3 runs) measured 9.7–17.9 px against 10.9–16.9 px with 5%
  loss: the loss adds coasted ticks (starved 0.9% → 4.9%), not
  prediction error. The error is the client's lead over the host, which
  grows with the round trip (server scenarios at 130–160 ms measure
  9–20 px with no loss: baseline-3p-100ms bot-c 13.6, mixed-3p bot-b
  19.7). So the 15 px bound is a bound on the round trip.
- Harness: every party bot starts its input clock 10 ms after a host
  tick. Before that, joins in a fixed order over seeded links gave each
  bot the same phase run after run: in four run sets the host's own
  user's ack p50 was 127–154 ms against the players' 151–153 ms, and
  bot-a's always 155–157 ms. Aligned, the four span 141–148 ms. The bot
  client speaks to a `BotTransport` (the server's socket, or a party's
  loopback end): `control-0ms --runs 3` after the refactor passes its
  baseline with default thresholds.
- Host mode's own framing is checked outside the bench: `check:godot`'s
  party session (a Node host on `defineHost`, two headless Godot players
  over the relay: moves, a death on `partyEvents`, a respawn,
  `partyClosed`), and two Chromium pages on `/game` (connected
  `RTCPeerConnection`s, the party's leaderboard with each player's round
  trip, a fair link of about half the guest's round trip, "Fair link off"
  with `?fairLink=off`, a party that ends when its host leaves the page
  or goes offline).
- quickdraw 5.1.3 findings: `qd.rooms` has no `clearHost` or `hostOf` at
  run time (the host-leave hook needs neither), and a host's own feed of
  a room it hosts gets no seed or items when it subscribed before
  `serve` (the page subscribes once it serves). `peers: true` is one
  switch for the whole server.
- Gate: the party baselines are this run's cards (label `g6-final`).

## 2026-10-23 — H7: Packed snapshots (the pack's G4) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  aed1669 (e78ea26 the codec; aed1669 the fixes from the review).
- Change: each world stream item packs one snapshot into bytes, base64 in
  `{ b }` (`packages/shared/src/game/snapshotCodec.ts` has the layout): a
  player is 21 B (28 in base64), against about 110 B of JSON. A player is
  an index into the stream's id table, which one `SnapshotEncoder` per
  runtime keeps. The keyframe (the seed) introduces every player, and each
  snapshot repeats the introductions of its last six ticks, as the food
  window repeats food. Positions are u32 tenths, directions i16
  thousandths: the sim's own rounding, so a decoded snapshot equals the
  JSON one. The bots and Godot (`snapshot_decoder.gd`) decode with one
  decoder per client, and ask for a keyframe when a snapshot names a
  player by an introduction they missed.
- Scenarios (the sweep, `--all --runs 3`, at aed1669 against the
  `g3-final` baselines, default thresholds): every scenario passes, no
  `warn`.
- Headline: `server.snapshotBytes` p95 501 → 168 B (−66%) in every
  3-player scenario, asym-2p 368 → 124, spectator-plus-2p 386 → 128; the
  mean 433 → 144 B. The plan's gate was −50%. Every other headline
  metric holds: teleportsPerMin, hardSnapsPerMin and food.mismatchAtEnd 0
  everywhere, renderLatencyMs unchanged, and each change inside its noise
  band (the largest: mixed-3p shapeErrorPx p95 4.89 → 6.00 px and jerkRms
  +12%, control-0ms inputAckRttMs p95 +15%).
- The first sweep (at e78ea26) failed two metrics: encounter-3p-100ms
  `server.tickDurMs.p95` 0.23 → 0.29 ms and jitter-heavy-3p jerkRms
  529 → 648. Review agents ran probes on the pod during it. The quiet
  sweep at aed1669 measures 0.25 ms and 557, both passing. The codec
  cannot move tickDurMs: the loop times `sim.step()` alone, before it
  packs the snapshot.
- Fixed from the review: a player the seed named was introduced in no
  snapshot after it, so a client that lost the seed's newer snapshots
  never learned the name (the introductions now repeat from the tick the
  index was first given). A keyframe more than six ticks older than the
  newest snapshot no longer names players, whose indexes may be another
  player's since. The count tunables (maxFood, initialFood, npcCount) stay
  at or under 65535, the layout's u16 counts.
- Godot: check:godot runs the GDScript decoder over the TS encoder's
  fixtures first (`apps/api/src/bench/codec-fixtures.ts`,
  `apps/game/godot/test/codec.gd`) and compares its players, food and
  keyframe asks with the TS decoder's, step by step; then the two-client
  session, through an API restart.
- Follow-up: Socket.IO's binary attachments would save the base64's third,
  once the GDScript client reads that format.
- Gate: the new baselines are this sweep's cards (label `g4-final`).

## 2026-10-23 — H3: Adaptive interpolation delay per client (the pack's G3) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  aebcd16 (76e89c9 the delay; 6798884 a 10 s memory, a 2-tick allowance
  and the fixes from the review; aebcd16 a reconnect that anchors the
  render timeline again, and the last review's fixes).
- Change: `PlaybackDelay` keeps exponentially weighted means (k = 2/201,
  about the last 10 s at 20 Hz) of the time between snapshot arrivals, of
  its variance, and of the frame time. The target delay is mean + 3σ + a
  frame, in ticks, clamped to 1.5–6. `WorldClock` keeps its H2 estimate
  and adds a render timeline behind it, which runs 5% fast or slow toward
  the target outside a 5 ms dead band, at most 2 ticks past the newest
  tick (the interpolators' extrapolation budget) and at most 12 ticks
  behind the estimate. A gap counts as 300 ms at most and a frame as
  250 ms. The GDScript port is `game.gd`'s playback section;
  `remote_snake.gd` renders at the render tick, as before.
- Scenarios (the sweep, `--all --runs 3`, at 6798884 against the
  `g2-final` baselines, with `bench-baselines/thresholds/g3-adaptive-delay.json`):
  every scenario passes, no `warn`. With the default thresholds six fail,
  each only on the metrics the user accepted (see the costs below).
- Headline: remotes render 40–50 ms sooner wherever the link is clean or
  mildly jittery, per client: control-0ms 125 → 80 ms; baseline-3p-100ms,
  encounter-3p-100ms, fps-varying-3p, spectator-plus-2p and both drift
  scenarios 175 → 125–130 ms; asym-2p 160/200 → 115/160 ms; mixed-3p's
  clean client 145 → 95 ms (its wobble 175 → 150, its spiky one
  unchanged). jitter-heavy-3p holds 175 ms. bursty-3p's two stalled
  clients render further behind (165 → 210/230 ms), so their buffers stop
  running dry; its clean client 165 → 115 ms. jerkRms −10…−60% everywhere
  (asym-2p −60%, encounter-3p-100ms −46%, bursty-3p −33%,
  spectator-plus-2p −33%, jitter-heavy-3p −28%). teleportsPerMin,
  hardSnapsPerMin and food.mismatchAtEnd 0 everywhere.
- Costs, the trade the user accepted on 2026-10-22: clients on unequal
  links render one snake at different moments. remoteVsRemotePx p50/p95:
  bursty-3p 0.02/0.78 → 17.4/22.2 px, mixed-3p 5.4/9.6 → 9.6/18.6 px,
  jitter-heavy-3p 0.02/0.19 → 0.59/2.27 px, at most 0.25/0.75 px
  elsewhere. A delay that follows the link leaves more residual after the
  best constant lag: shapeErrorPx p95 jitter-heavy-3p 4.60 → 6.86,
  bursty-3p 2.35 → 3.52, mixed-3p 3.47 → 4.89 px. bursty-3p
  ownVsRemotePx p95 58.8 → 74.5 px and its headline renderLatencyMs
  +12%: the stalled clients' longer delay.
- The plan's literal design (k = 2/31, the render clock never past the
  newest tick; the sweep of 76e89c9) failed its own gate on
  jitter-heavy-3p: jerkRms +36%, shapeErrorPx p95 +107%, though clean
  links already rendered 26–33% sooner. Two causes, each measured alone
  (one run each, jitter-heavy-3p):
  - A 1.5 s memory forgets a spike before the next one, so the delay sank
    to the floor between spikes and chased each one. k = 2/201 keeps a
    spiky link's spikes in σ, and one delay: remoteVsRemotePx p95
    10.9 → 4.0 px, but jerk still +37%.
  - Holding the render clock at the newest tick froze every remote on
    each late snapshot, a stop and a start. Two ticks of allowance make a
    late snapshot cost a short extrapolation, as with the fixed delay:
    jerk −30% (bursty-3p −37%), shapeErrorPx +14%, remoteVsRemotePx p95
    1.9 px. (k = 2/31 with the allowance: jerk −11%, shapeErrorPx +103%.)
- Fixed since the first sweep, from the review and after it: the delay
  had no ceiling after a stall of seconds (the 12-tick lag cap now), one
  outage or hitch held the target up (the gap and frame caps), and a
  reconnect to the same server counted the outage as a gap and restarted
  the render timeline from an estimate that drifted while nothing arrived
  (it now forgets the timeline, keeps what it learned of the link, and
  anchors on the next snapshot). Bots never reconnect within a run
  (`reconnection: false`), so the reconnect change moves no bench number.
- The 2026-08-01 dead end (per-client adaptive delay, bursty
  remoteVsRemotePx p50 38 px) is re-adopted on purpose: with the floor,
  the ceiling, the warp and the 10 s memory, bursty-3p's p50 is 17 px.
  HYPOTHESES.md #4b (one delay for the room) is closed untested.
- Godot: the port settles at about 1.57 ticks on a clean link in
  check:godot, as the bots do. An arrival there is the frame that polled
  it, so a link's gaps carry up to a frame more spread than the bots'.
- Tier-2 (`apps/bench-web`, baseline-3p-100ms, headless, one run each,
  back to back: the pre-G3 pck, then the G3 pck): headless Chromium in the
  pod renders the game at 8 fps, so this checks that the port runs, not
  how smooth it is. At 125 ms a frame, snapshots arrive in bursts of two
  or three and the frame term is 2.5 ticks, so the delay goes to its
  6-tick ceiling: remotes render 465–530 ms behind, from 310–350 ms.
  remoteVsRemotePx p50/p95 2.6/16.0 → 1.6/13.2 px, jerkRms
  306/430/884 → 311/265/689, teleports 0. G3 leaves the local snake as it
  was; its numbers vary from run to run at 8 fps.
- Gate: `bench-baselines/thresholds/g3-adaptive-delay.json` raises the
  floors of the accepted metrics only, for G3's sweep against the pre-G3
  baselines. The new baselines are this sweep's cards (label `g3-final`),
  so later changes take the default thresholds again; mixed-3p is new,
  its pre-G3 baseline at 44d9c31.

## 2026-10-23 — Food window: food changes repeated for six ticks (the pack's G2) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  210e697 (11f0180 the window; 08d654e and 210e697 the fixes from the two
  review passes).
- Change: each world snapshot carries `food`, the food changes of the last
  six ticks that changed food (`GAME_FOOD_WINDOW`), oldest first, where it
  carried only its own tick's `foodSpawned`/`foodEaten`. A client applies
  each tick's change once, in tick order. A snapshot more than six ticks
  past the last one it applied means changes were lost: the client
  subscribes to the stream again, and the seed, a keyframe with all the
  food in one entry, replaces its food. A client takes only a keyframe's
  food: the Godot client hands a reply over a frame after the stream items
  that came with it, so a keyframe can be handled after newer snapshots.
  Deaths, joins and the leaderboard stay reliable events.
- The plan's gap rule (the oldest entry's tick past the last tick applied,
  plus one) counts from the snapshot's tick instead: entries exist only
  for ticks that changed food, so an oldest entry past the last tick
  applied, plus one, is normal.
- Scenarios (the sweep, `--all --runs 3`, at 210e697 against the
  `g1-queue-final` baselines): every scenario passes, no `warn`, nothing
  past the noise. A first sweep at 11f0180, before the review's fixes,
  passed too.
- Headline: `foodMismatchAtEnd` 0 in the worst run of every scenario
  (`runWorst`), `foodResyncs` 0. jitter-heavy-3p dropped 1.1–2.0% of its
  snapshots (gapRate) and mixed-3p's spiky client 1.2%, all within the
  window. bursty-3p's stalls (250 ms every 2 s) dropped none on this
  machine (gapRate 0, as in the baseline), so the keyframe path runs in the
  game's integration test (10 snapshots missed) and in check:godot (a
  second of them missed). snapshotBytes p95 +23…+51 B (+7…+11%), mean
  +36…+56 B (+10…+18%): about 1 KB/s more per client.
- Gate: the worst client's mismatch is a headline metric,
  `food.mismatchAtEnd`, that must be 0 in every run (`MUST_BE_ZERO`, judged
  on an aggregated card's worst run), so a later netcode change cannot lose
  food changes unseen. The new baselines are this sweep's cards (scorecard
  schemaVersion 2, with `runWorst`).

## 2026-10-23 — H5: Input queue and redundant frames (the pack's G1) [KEPT]

- Branch: conveyor/netcode-level-up-loss-tolerant-server-mo-k462dt at
  51d3a76 (a429eea the queue, 38f917b and 51d3a76 the fixes from the
  review). The variants tried are kept on `wip/g1-input-queue` (F 0749d3b,
  D ed033e4, A 822c3c5, H2 f389b59).
- Change: the input channel carries `{ frames }`, the newest last with up
  to three unacknowledged ones before it. Each human snake queues its
  frames once by seq (`InputQueue`) and steps one a tick unless a backlog
  builds, so `PlayerSnap.ack` names the last frame the server's state
  holds. A tick without a frame coasts on the last intent: while nothing
  arrives, the coast stands in for the late frame, which is ignored when
  it arrives; while frames arrive but none can step (a slow clock, a
  client back from a pause), the coast is owed (a frame that arrives with
  another after it pays it, the debt expires after four ticks). A second
  frame steps in a tick only from a backlog, or after a frame waited 10
  ticks. Every step, coasts included, spends the 1.15-a-tick credit. A tick
  of several steps checks collisions at every head it passed. The loop
  ticks on an exact 20 Hz grid (`setInterval` ran at 19.94 Hz).
- Scenarios (the sweep, `--all --runs 3`, at 51d3a76 against the
  `core-5.1.3` baselines): no `fail`. One `warn`: fps-varying-3p
  ownVsRemotePx p95 65.0 → 72.2 (+11%). jerkRms asym-2p −43%,
  jitter-heavy-3p −36%, encounter-3p-100ms −29%, fps-varying-3p −17%,
  spectator-plus-2p −17%, the rest within noise. inputAckRttMs p95 −6…−16%
  or ok.
- Headline: correctionPx p95 at most 0.8 px on every client of every
  scenario, from 9 px (one movement step) and 16 px on jitter-heavy-3p.
  teleportsPerMin 0 everywhere.
- The plan's queue (A: full credit, up to three frames a tick, a starved
  tick skipped) fails its own gate: corrections 9 → 0.1 px, but jerkRms
  +202…+225% on the three-player scenarios. A client steps its 20 Hz sim
  from a 60 fps loop, so its frames leave with up to ~17 ms of jitter. A
  client whose frames reach the server within that of the tick (about one
  in three, by the chance of its connect time) flips them between ticks:
  stepping what arrived gives "2, 0", which every viewer's interpolation
  shows as a pause and a double step. Every server-only rule makes such a
  client pay one of input latency (a held frame), stutter (the skip) or a
  correction (a coast); a coast that stands in for the late frame makes
  the correction only that frame's change of intent.
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
  - H (a coast stands in for the late frame, at most four in a row): it
    switched between coasting and holding a frame and double-stepped:
    baseline-3p-100ms jerk +38%.
  - H2 (H, a stood-in frame that arrives alone makes the next coast owed):
    no fail in its sweep (a429eea, the verdict of 317a820), but the review
    found four faults: coasts were free steps (a client that held frames
    back for bursts moved about 1.5× as fast); a three-step boosted tick
    (48 px) could step over a body (19 px kill distance); after an uplink
    stall of more than four coasts the capped debt let stale frames step
    again (a lurch of about 100 px); and a client back from a pause had no
    prediction for as long as it paused (its seqs stayed under the ack).
  - Clients numbering past any ack ahead of them (the first fix for the
    last fault): at 0 ms a stand-in often runs the ack one ahead of a frame
    the client has not stepped yet, and renumbering there made the queue
    hold and drain frames in a cycle (control-0ms double steps 1.4%, jerk
    +30%). They number past the ack only when it ran more than four ahead.
- tickDurMs: every single run before the first sweep measured 0.21 → 0.30
  ms p95, G1 or not. The unchanged pre-G1 code measured the same in the
  same hour (control-0ms 0.26, baseline-3p-100ms 0.35 ms p95), and the
  sim's step alone costs 0.026 ms p50 with or without G1. The machine
  moved it; in the sweeps it was 0.17–0.26 ms.
- The exact loop keeps each client's phase for a whole run, so the metrics
  that depend on a client's phase now spread across runs: control-0ms
  ownVsRemotePx p95 by 5–11 px (the drifting loop averaged every phase),
  which is why its +18% is within noise. predictionErrorPx p95, mostly the
  client's one-tick lead, spreads per client: baseline-3p-100ms
  10.0/13.0/12.2 → 3.6/11.0/15.6, jitter-heavy-3p 12.3/17.7/17.8 →
  11.2/8.4/18.5.
- Bounds the plan set for the skip design: control-0ms `starvedRate` 0.73%
  (bound < 0.5%); drift-slow-client 2.00%, 5.9% for the slow client (bound
  0.5–2%). A coasted tick is cheap: the snake moves and nothing stutters.
  `multiStepRate` stays at or under 0.35% everywhere (bound < 5%), 1.03%
  for the fast client. drift-fast-client: depth p95 1, trend 0.17, starved
  0.10% (bounds met).
- inputAckRttMs is partly shorter by definition: a stand-in coast
  acknowledges its frame before the frame arrives.
- The gate: `server.inputQueue.depthP95` joins the headline metrics with a
  floor of one frame, not the planned 0.05 (a client's queue holds 0 or 1
  by its phase; a ratchet grows by more), and any growth past a floor from
  a zero baseline now fails (it was called ok, a first teleport included).
- Baselines: all ten scenarios are this sweep's (label `g1-queue-final`),
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
