# Game Patterns

The game foundation (GameService + Godot client) extends the service
architecture with real-time patterns. Everything here can be carved out of a
fork with `./scripts/init-fork.sh <name> --without-game`.

## Channels vs methods

- **Methods** (`defineMethod`) — request/response, ack'd, full async ACL, global
  rate limiter. Use for every command: `joinGame`, `respawn`, a spell cast, a
  "start next wave" button. Callable identically from React hooks and the Godot
  client — this is the point: game commands stay typed and secured like all
  other quickdraw traffic.
- **Channels** (`defineChannel`) — fire-and-forget, no ack, per-socket token
  bucket, synchronous in-memory access checks only. Use ONLY for tick-rate
  traffic where the next message supersedes the last (player input). Payloads
  route as `channel:gameService:<name>` and are zod-validated per message.
- Server → client tick data uses `emitToRoomVolatile` (backpressured clients
  drop frames); anything a client must not miss (join/leave/death/leaderboard)
  uses regular `emitToRoom`.

## Ordering contract (clients)

`subscribe("gameService", GLOBAL_WORLD_ID)` **before** `watchWorld`/`joinGame`
— room membership is what gates the input channel (`requireRoom`) and
delivers snapshots. The web boots Godot into SPECTATE (`watchWorld`: full
bootstrap, no spawn); the React pre-game dialog then calls `joinGame` on the
page's own socket and Godot spawns the local snake when its id appears in a
snapshot. Presence is room-anchored: a player stays in the sim while ANY of
their subscribed sockets remains (page + Godot are two sockets, one user).
Then send input frames; reconcile against `PlayerSnap.ack`.

NPCs (`npc-` ids) live inside `GameWorldSim` (seeded, deterministic,
`npcCount` tunable) and reach clients as ordinary remote players; they never
persist scores and don't count toward `humanCount()` idle checks.

## Simulation rules

- `GameWorldSim` (services/game/world.ts) is **pure and deterministic**: no
  I/O, no `Date.now()`, seeded RNG, fixed timestep (`GAME_TICK_RATE`). Unit
  tests drive it directly; integration tests drive `gameService.loop.tickOnce()`
  (the loop is never auto-started in tests).
- **No database access anywhere in the tick path.** Persistence (score upserts)
  happens in fire-and-forget promises triggered by loop callbacks.
- Only snake heads go on the wire — bodies are derived from head-path history
  on both sides. Keep snapshots small; add fields consciously.
- The world row (`GameWorld`) exists for subscriptions/rooms/admin only. It
  uses the deterministic id `GLOBAL_WORLD_ID` from `@project/shared` so boot,
  seed, and tests converge on the same row (`ensureGlobalWorld`).

## Scaling note

The sim is single-process in-memory: production deploys must pin the API to
one instance (Cloud Run `max-instances=1`) or move the game to its own service
before scaling out.
