# Game Patterns

The game foundation (gameService + the Godot client) extends the service
architecture with quickdraw 5.0's realtime kit. Everything here can be carved
out of a fork with `./scripts/init-fork.sh <name> --without-game`.

## Methods, the channel, the stream and the events

All of it is declared in `packages/shared/src/contracts/game.ts`:

- **Methods** — request/response, acknowledged, full access checks. Use for
  every command: `joinGame`, `respawn`, a spell cast, a "start next wave"
  button. Callable identically from React (`qd.gameService.joinGame.useMutation()`)
  and the Godot client (`Net.client.call_method(...)`): game commands stay
  typed and secured like all other quickdraw traffic.
- **The `input` channel** — fire-and-forget (`qd:ch`, never answered),
  per-socket token bucket, payload checked against the contract. Use ONLY for
  tick-rate traffic where the next message supersedes the last (player
  input). `requires: { room: GLOBAL_WORLD_ROOM }`: dropped unless the sending
  socket is in the world's room; anonymous sockets are always dropped.
- **The `world` stream** — every tick's snapshot, pushed by the loop with
  `qd.stream(gameContract, "world").push(worldId, snapshot)`: volatile
  (backpressured clients drop frames), seeded with the latest snapshot,
  public (signed-out visitors spectate).
- **Events** (`playerJoined`, `playerLeft`, `death`, `leaderboard`,
  `scoreSaved`) — reliable, sent to the world's room with `qd.rooms.emit`
  (from the loop) or `ctx.rooms.emit` (from a handler). Anything a client must
  not miss is an event, never a stream item.

## Rooms and the ordering contract (clients)

App rooms are per socket. `watchWorld` (spectate, public) and `joinGame`
(spawn) put the CALLING socket in `GLOBAL_WORLD_ROOM`: it then hears the
world's events, counts as its audience, and may send input. A reconnected
socket is in no room until it calls again, so clients call on every
connection:

1. subscribe to the `world` stream (`qd:stream:sub`; the GDScript client
   subscribes again by itself after a reconnect);
2. call `watchWorld` or `joinGame` over the same socket (bootstrap);
3. send input frames; reconcile against `PlayerSnap.ack`.

The web boots Godot into SPECTATE (`watchWorld`: full bootstrap, no spawn);
the React pre-game dialog then joins the game on the page's own socket and
Godot spawns the local snake when its id appears in a snapshot. The page's
socket joins with `useJoin` (`GameSurface.tsx`), which runs the call again
on every connection: `watchWorld` always (its HUD hears the world), and
`joinGame` while the user plays and is alive (Respawn lets it run again:
joinGame spawns a dead player's snake). Presence is room-anchored: a player stays in the sim
while ANY of their sockets is in the world's room (page + Godot are two
sockets, one user); `createServer({ onRoomLeave: onGameRoomLeave })` removes
the player (and sends `playerLeft`) when the last one leaves or disconnects.
Every server root passes it: the API (`index.ts`), the test app
(`__tests__/utils/app.ts`) and the bench (`bench/server.ts`).

NPCs (`npc-` ids) live inside `GameWorldSim` (seeded, deterministic,
`npcCount` tunable) and reach clients as ordinary remote players; they never
persist scores and don't count toward `humanCount()`. The loop freezes only
when `humanCount() === 0` AND nobody is in the world's room
(`worldAudience(server)`, spectators and anonymous sockets included) —
spectators behind the pre-game dialog keep the NPC world running.

## Simulation rules

- `GameWorldSim` (services/game/world.ts) is **pure and deterministic**: no
  I/O, no `Date.now()`, seeded RNG, fixed timestep (`GAME_TICK_RATE`). Unit
  tests drive it directly; integration tests drive `gameRuntime(db).loop.tickOnce()`
  (the loop is never auto-started in tests).
- **No database access anywhere in the tick path.** Persistence (score
  upserts) happens in detached `qd.run` units triggered by loop callbacks;
  `scoreSaved` follows the write, so a client that reads the scores again sees
  it.
- Only snake heads go on the wire — bodies are derived from head-path history
  on both sides. Keep snapshots small; add fields consciously (each stream
  frame also carries its `[service, stream, scope]` envelope).
- The world row (`GameWorld`) exists for its chat and the admin screen. It
  uses the deterministic id `GLOBAL_WORLD_ID` from `@project/shared` so boot,
  seed, and tests converge on the same row (`ensureGlobalWorld`, tracked
  writes in `qd.run`: call it after `createServer`).

## Checks

- `bun run --filter @project/api test`: the sim, the loop, and the game over
  real protocol 5 sockets (`game.int.test.ts`).
- `bun run check:godot`: two real headless Godot clients in one world, through
  an API restart (see `apps/game/README.md`).

## Netcode benchmarking

Netcode changes are judged by scorecards, not eyeballs: `bun run
bench:netcode` runs headless bot clients (TS ports of the Godot netcode in
`apps/api/src/bench/bot/` — keep them in lockstep with `local_snake.gd` /
`remote_snake.gd` / `game.gd`'s world clock) over protocol v5 through a
latency proxy against a live-loop server. See `docs/netcode-bench.md`,
baselines in `bench-baselines/`, and the `/netcode-rd` skill for the
hypothesis loop.

## Scaling note

The sim is single-process in-memory: production deploys must pin the API to
one instance (Cloud Run `max-instances=1`) or move the game to its own service
before scaling out. `worldAudience` reads this process's sockets only.
