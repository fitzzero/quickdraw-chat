# @project/bench-web — the browser tier, and `bench:play`

Drives REAL Chromium tabs running the web app's game client through
per-client latency proxies, and emits the same scorecard as the headless
Tier-1 harness (`bun run bench:netcode`) with the browser tier's own block
(frame-time tails, long tasks, geometry builds, draw calls, the backend).
See `docs/netcode-bench.md`.

```bash
# prerequisites: bun run dev (web on :3000), bun run --cwd apps/api playwright:install
bun run bench:web                                        # the default list on both GPU backends
bun run bench:web -- --scenario render-stress-8p --gpu webgl --window-position 2000,0
bun run bench:web -- --all --label desk
```

Flags: `--scenario <name>` or `--all` (default: `baseline-3p-100ms`,
`jitter-heavy-3p`, `render-stress-8p`), `--gpu webgl|webgpu|both` (default
both: one card per backend, the backend in its label), `--web-url` (default
http://localhost:3000), `--headless` (SwiftShader WebGL runs ~30fps — fine
for plumbing checks, misleading for smoothness numbers; default is headed),
`--label <text>`, `--window-position x,y` (the display meant), `--hz 144`
(the display's rate, declared: read from the frames, a display at half rate
looks like a slower display). Each card is judged against the absolute
acceptance of its display rate (`acceptanceFor`), and the run exits 1 on a
miss.

How it works: spawns `apps/api/src/bench/standalone.ts` (bench server +
proxies, prints READY with per-client proxy ports), opens
`/game?bench=1&gpu=…&benchApi=…&benchUser=…` per client (dev-gated page →
the bare game client, dev-credential auth, self-spawn), wanders each snake
through the real input path with Playwright mouse moves (`wander.ts`),
drains the `window.QuickdrawBench` telemetry batches every second (frames,
arrivals, sends, corrections, fps, long tasks, the renderer's stats), and
scores the traces against the server's ground-truth record.

## `bench:play`: a deployed instance

```bash
bun run bench:play -- --url https://quickdraw-dev.techtree.gg/game --seconds 60
```

`probe-live.ts` opens the page in a headed Chromium, signs in as a guest
through the real dialog, plays a human-like wander, and measures from
inside the page: the world stream's arrival gaps and the player's own ack
deltas (the packed stream decoded with the shared `SnapshotDecoder`), the
rAF gaps and long tasks, the input send gaps, the renderer's backend, draw
calls and geometry builds from the page's stats line (`?debug=1`), and
every socket open or close; it respawns through the dialog when it dies,
and judges from the first snapshot that holds the player's snake. Exit 1 on
a long task, a geometry build after the first second, an ack delta of 0, or
frame-time tails over the display rate's acceptance. The raw samples land
in `bench-results/play/`. Flags: `--url`, `--seconds`, `--name`, `--gpu`,
`--hz`, `--window-position`, `--headless`.

Known gaps vs Tier 1: no input→ack RTT (the page's telemetry doesn't
correlate acks yet) and single-run only (no `--runs` median aggregation).
