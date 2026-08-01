---
name: netcode-rd
description: Run one iteration of the netcode R&D loop — pick the next hypothesis from docs/netcode-rd/HYPOTHESES.md, implement it on a branch, benchmark it against bench-baselines/, auto-merge winners into netcode/rd, and record the verdict in the ledger. Designed to be repeated via /loop /netcode-rd.
---

# Netcode R&D Loop — one iteration

You are running one iteration of an autonomous netcode improvement loop for
the snake game. The evaluation function is the Tier-1 benchmark harness
(`docs/netcode-bench.md`). Winners auto-merge into the integration branch
`netcode/rd`; the user reviews the accumulated result at the end via a
single PR to main.

## Protocol

1. **Orient.** Read `docs/netcode-rd/LEDGER.md` and
   `docs/netcode-rd/HYPOTHESES.md`. Pick the FIRST hypothesis with no ledger
   entry. If all have entries, or the ledger shows 3 consecutive DISCARDED
   entries, STOP the loop (`ScheduleWakeup stop` if running under /loop) and
   summarize findings for the user instead.

2. **Branch.** Ensure `netcode/rd` exists (create from current main if not).
   Create a worktree branch `netcode/<slug>` off `netcode/rd` (use
   EnterWorktree or `git worktree add`). All work happens there.

3. **Implement** the hypothesis in the Tier-1 netcode first:
   - Client-side ideas → `apps/api/src/bench/bot/prediction.ts` /
     `interpolation.ts` / `client.ts`.
   - Server/wire ideas → `packages/shared/src/types/game.ts` +
     `apps/api/src/services/game/` (+ keep the bots consuming the new wire).
   - Keep diffs surgical. `bun run check` must stay green; run
     `bun run test:unit` if you touched `services/game` or `packages/shared`
     (and `bun run test:int` when the wire format changed).

4. **Self-check the harness** after any harness-adjacent change:
   `bun run bench:netcode -- --scenario control-0ms --duration 15` — expect
   ~0 divergence and 0 teleports; if not, fix the harness before judging
   netcode.

5. **Benchmark.** From the worktree:
   `bun run bench:netcode -- --scenario baseline-3p-100ms --runs 3` and the
   same for `jitter-heavy-3p` and `encounter-3p-100ms`. Then for each:
   `bun run bench:compare bench-baselines/<scenario>.json bench-results/<scenario>/<newest>.json`

6. **Verdict.**
   - **KEEP** iff baseline-3p-100ms PASSES with ≥1 `improved` headline
     metric that is NOT `within-noise`, AND the other two scenarios show no
     `fail`. Mind the run-variance column — a "win" inside the noise band is
     a DISCARD (or rerun with `--runs 5` if it looks close).
   - Otherwise **DISCARD**.

7. **Record + integrate.**
   - Append a ledger entry (template at the top of LEDGER.md) with the
     actual numbers, on the branch that survives.
   - KEEP: merge `netcode/<slug>` into `netcode/rd` (no-ff), regenerate the
     three baseline scorecards ON `netcode/rd`
     (`bun run bench:netcode -- --scenario <s> --runs 3` × 3, copy the new
     aggregated cards into `bench-baselines/<scenario>.json`), commit, and
     if the change affects client behavior note "GDScript port pending" in
     the ledger entry (the Godot port + Tier-2 validation happens in a
     dedicated pass, not mid-loop).
   - DISCARD: commit only the ledger entry to `netcode/rd`; delete the
     hypothesis branch and its worktree.

8. **Report.** End the iteration with a short summary: hypothesis, verdict,
   the 3 headline deltas, and what the next iteration will pick up.

## Guardrails

- Never edit `bench-baselines/` except when regenerating after a KEEP merge.
- Never weaken `DEFAULT_THRESHOLDS` or metric definitions to make a
  hypothesis pass; harness changes require a clean `control-0ms` and their
  own commit, clearly separated from netcode changes.
- If the same scenario's `runVariance` exceeds the improvement you're
  chasing, prefer raising `--runs` over declaring victory.
- Wire-format changes must keep the Godot client functional (additive
  fields only, or gate behind tolerant parsing) — the WASM build in
  apps/web/public/game lags the TS side until a dedicated port pass.
- Keep each iteration to ONE hypothesis; spin discovered side-issues into
  new HYPOTHESES.md entries instead of expanding scope.
