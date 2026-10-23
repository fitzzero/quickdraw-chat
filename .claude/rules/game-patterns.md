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
  typed and secured like all other quickdraw traffic. The high scores
  (`getHighScores`, `getMyBest`) declare `watch: { service: ["gameScore"] }`:
  a stored score (a GameScore row, which gameService lists in `writes`)
  changes the service's topic (open to anyone: `watchAccess: "public"`),
  whose frame names the models written (`models`), and their readers read
  them again; an edit of a world row changes the topic too, and they skip
  it. The world chat's memberships are the chat service's: `watchWorld` and
  `joinGame` put the caller in it through
  `ctx.services.chatService.joinWorldChat`, which adds the membership (and
  counts the member) the first time only. A death stores a new best only.
- **The `input` channel** — fire-and-forget (`qd:ch`, never answered),
  per-socket token bucket, payload checked against the contract. Use ONLY for
  tick-rate traffic (player input): one message per client tick, its newest
  frame last with up to three unacknowledged ones before it, so a lost
  message's frames ride the next. The sim queues each frame once by seq
  (`InputQueue`) and steps one a tick unless a backlog builds; a tick
  without one coasts on the last intent, and the ack covers the coast (a
  late frame it stood in for is ignored when it arrives). So a snake moves
  every tick, and `PlayerSnap.ack` names the last frame the server's state
  holds.
  `requires: { room: GLOBAL_WORLD_ROOM }`: dropped unless the sending socket
  is in the world's room; anonymous sockets are always dropped. One world,
  so one room by name; a game of many worlds requires
  `{ room: { prefix: "world:" } }` and reads the world from `ctx.room`.
- **The `world` stream** — every tick's snapshot, packed into bytes and
  pushed by the loop with
  `qd.stream(gameContract, "world").push(worldId, { b })` (base64, about a
  third of its JSON; `game/snapshotCodec.ts` in the shared package has the
  layout): volatile (backpressured clients drop frames), public (signed-out
  visitors spectate, and clients subscribe before they join the world's
  room). Each subscriber starts from the current world, which the service
  computes (`streams.world.seed`: the runtime's `keyframe()`, every snake
  and all the food, read from memory, never the database), and the
  snapshots that follow are deltas of it. Every snapshot carries every
  snake's head, so a dropped one costs a frame of motion only; a food change
  happens on one tick, so each snapshot repeats the food changes of the
  last six ticks (`GAME_FOOD_WINDOW`: `food`, one entry per tick that
  changed, kept by the loop). A client applies each tick's entry once, in
  tick order. A snapshot more than six ticks past the last one it applied
  means changes were lost: the client subscribes again (a held feed
  answers a fresh seed), and the keyframe (the seed, all the food in one
  entry) replaces its food. A snapshot names its players by the stream's
  id table, which one SnapshotEncoder per runtime keeps: the keyframe
  introduces every player, and each snapshot the players first introduced
  in its last six ticks (a seed's new player from the next tick on). A
  client decodes with one SnapshotDecoder (`snapshot_decoder.gd` in Godot),
  kept across its subscriptions and reset for another server's world, and
  asks for a keyframe when a snapshot names a player by an introduction it
  missed (`needsKeyframe`). A client takes a keyframe's food and its names,
  never its snakes: it may be handled after newer snapshots, which place
  the snakes (and names from one older than the newest snapshot's window
  are ignored). Stream items are checked against the schema in development
  and tests only (`validate: "development"`).
- **Events** (`playerJoined`, `playerLeft`, `death`, `leaderboard`) —
  reliable, sent to the world's room with `qd.rooms.emit` (from the loop) or
  `ctx.rooms.emit` (from a handler). Anything a client must not miss is an
  event, or a stream field repeated as the food changes are (a window of
  ticks, a keyframe past it); never a stream item sent once.

## Rooms and the ordering contract (clients)

App rooms are per socket. `watchWorld` (spectate, public) and `joinGame`
(spawn) put the CALLING socket in `GLOBAL_WORLD_ROOM`: it then hears the
world's events, counts as its audience, and may send input. A reconnected
socket is in no room until it calls again, so clients call on every
connection:

1. subscribe to the `world` stream (`qd:stream:sub`; the GDScript client
   holds the feed, `is_subscribed`, and subscribes again by itself after a
   reconnect);
2. call `watchWorld` or `joinGame` over the same socket (bootstrap);
3. send input frames (each message with the unacknowledged ones before its
   newest); reconcile against `PlayerSnap.ack`, and when the ack ran more
   than four frames past the newest (the server coasted through a stall),
   number the next frame after it.

The web boots Godot into SPECTATE (`watchWorld`: full bootstrap, no spawn);
the React pre-game dialog then joins the game on the page's own socket and
Godot spawns the local snake when its id appears in a snapshot. The page's
socket joins with `useJoin` (`GameSurface.tsx`), which runs the call again
on every connection: `watchWorld` always (its HUD hears the world), and
`joinGame` while the user plays and is alive (Respawn lets it run again:
joinGame spawns a dead player's snake). Presence is room-anchored: a player
stays in the sim while ANY of their sockets is in the world's room (page +
Godot are two sockets, one user); gameService's own `onRoomLeave` removes
the player (and sends `playerLeft`) when the last one leaves or disconnects,
in every server the service runs in (the API, the test app, the bench).

A server restart is a new world whose ticks start over: the Godot client
tells it from a network blip by the hello's `server_id`, as the bench bots
do with `serverId`. Every hello anchors the world clock again on the next
snapshot; another server's also forgets what the playback delay learned of
the link (a blip keeps it).

NPCs (`npc-` ids) live inside `GameWorldSim` (seeded, deterministic,
`npcCount` tunable) and reach clients as ordinary remote players; they never
persist scores and don't count toward `humanCount()`. The loop freezes only
when `humanCount() === 0` AND nobody is in the world's room
(`qd.rooms.size(GLOBAL_WORLD_ROOM) > 0`, spectators and anonymous sockets
included) — spectators behind the pre-game dialog keep the NPC world running.

## Simulation rules

- `GameWorldSim` (services/game/world.ts) is **pure and deterministic**: no
  I/O, no `Date.now()`, seeded RNG, fixed timestep (`GAME_TICK_RATE`). Unit
  tests drive it directly; integration tests drive `gameRuntime(db).loop.tickOnce()`
  (the loop is never auto-started in tests).
- **No database access anywhere in the tick path.** Persistence
  (`persistScore`: a new best only) happens in detached `qd.run` units
  triggered by loop callbacks; the tracked write changes the service topic
  the score queries watch.
- A tick that steps a snake several times (its client's backlog) checks
  collisions at every head the snake passed, not only the last.
- Only snake heads go on the wire — bodies are derived from head-path history
  on both sides. Keep snapshots small; add fields consciously (each stream
  frame also carries its `[service, stream, scope]` envelope).
- The world row (`GameWorld`) exists for its chat and the admin screen. It
  uses the deterministic id `GLOBAL_WORLD_ID` from `@project/shared` so boot,
  seed, and tests converge on the same row (`ensureGlobalWorld`, tracked
  writes in `qd.run`, before or after `createServer`).
- Admin edits of definitions reach the running sim through the admin kit's
  `onCommitted` (`definitionService`, `onChanged`), once the edit committed
  and without holding up its reply: an edit that failed or rolled back never
  reaches the sim. What must happen inside the edit's transaction (a write
  of its own) belongs in `onWrite`, as `messageService`'s.

## Checks

- `bun run --filter @project/api test`: the sim, the loop, and the game over
  real protocol 5 sockets (`game.int.test.ts`, its frames matched with
  `streamFrames` and `eventFrames`).
- `bun run check:godot`: two real headless Godot clients in one world, through
  an API restart (see `apps/game/README.md`).

## Netcode benchmarking

Netcode changes are judged by scorecards, not eyeballs: `bun run
bench:netcode` runs headless bot clients (TS ports of the Godot netcode in
`apps/api/src/bench/bot/` — keep them in lockstep with `local_snake.gd` /
`remote_snake.gd` / `game.gd`'s world clock / `main.gd`'s food) over
protocol v5 through a
latency proxy against a live-loop server. See `docs/netcode-bench.md`,
baselines in `bench-baselines/`, and the `/netcode-rd` skill for the
hypothesis loop.

## Scaling note

The sim is single-process in-memory: production deploys must pin the API to
one instance (Cloud Run `max-instances=1`) or move the game to its own service
before scaling out. `qd.rooms.size` counts this process's sockets only.
