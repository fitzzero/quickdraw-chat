# @project/bench-web — Tier-2 netcode benchmark

Drives 2–3 REAL Chromium tabs running the production web app + Godot WASM
through per-client latency proxies, and emits the same scorecard as the
headless Tier-1 harness (`bun run bench:netcode`). See `docs/netcode-bench.md`.

```bash
# prerequisites: bun run dev (web on :3000), a WASM export that includes the
# Bench autoload (apps/game/export-web.sh), bunx playwright install chromium
bun run --cwd apps/bench-web bench -- --scenario baseline-3p-100ms
```

Flags: `--scenario <name>`, `--web-url` (default http://localhost:3000),
`--headless` (SwiftShader WebGL runs ~30fps — fine for plumbing checks,
misleading for smoothness numbers; default is headed), `--label <text>`.

How it works: spawns `apps/api/src/bench/standalone.ts` (bench server +
proxies, prints READY with per-client proxy ports), opens
`/game?bench=1&benchApi=…&benchUser=…` per client (dev-gated page → bare
Godot canvas, dev-credential auth, self-spawn), wanders each snake through
the real input path with Playwright mouse moves, drains the
`window.QuickdrawBench` telemetry batches every second, and scores the
traces against the server's ground-truth record.

Known gaps vs Tier 1: no input→ack RTT (the Godot telemetry doesn't
correlate acks yet) and single-run only (no `--runs` median aggregation).
