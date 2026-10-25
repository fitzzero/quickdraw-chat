# Game Patterns

The game foundation (gameService + the web's game client) extends the service
architecture with quickdraw 5.0's realtime kit. Everything here can be carved
out of a fork with `./scripts/init-fork.sh <name> --without-game`.

## Methods, the channel, the stream and the events

All of it is declared in `packages/shared/src/contracts/game.ts`:

- **Methods** — request/response, acknowledged, full access checks. Use for
  every command: `joinGame`, `respawn`, a spell cast, a "start next wave"
  button. Callable identically from React (`qd.gameService.joinGame.useMutation()`)
  and from any client of the protocol (the bench bots' `callData`): game commands stay
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
  without one coasts on the last intent, and the ack covers the coast as
  the client's next frame: that frame, when it arrives, is not stepped but
  steers the next step (world.ts `queueInputs`). So a snake moves every
  tick, `PlayerSnap.ack` names the last frame the server's state holds,
  and the ack always counts the steps: the client's replay never meets a
  step it did not predict (one would be a 9 px jolt), only the change of
  intent of a frame a coast stood in for. The bench gates it
  (`server.inputQueue.stepAckMismatchPerMin`, must be 0). The server's
  consumption clock is fixed (one seq a tick from the first frame on), so
  the client's frame clock follows it: the tick's snapshot after a late
  frame steered, or after the client numbered past a frame a coast stood
  in for (at a round trip under a tick), says `PlayerSnap.late`, and a client that hears it on a
  fifth of its snapshots moves its frame clock half a tick earlier (at
  most once per half second, never later), off the tick boundary; jitter
  alone stays under that rate while its spread is under about half a
  tick. Only on that bit: an ack past the newest frame is also what a
  round trip under a tick looks like.
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
  client decodes with one SnapshotDecoder, kept across its subscriptions
  and reset for another server's world, and
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

1. subscribe to the `world` stream (`qd:stream:sub`; the page's transport
   and the bots' subscribe again on every hello, `pageTransport.ts` and
   `socket-transport.ts`);
2. call `watchWorld` or `joinGame` over the same socket (bootstrap);
3. send input frames (each message with the unacknowledged ones before its
   newest); reconcile against `PlayerSnap.ack`, and when the ack ran past
   the newest (a coast stood in for a frame not yet stepped: a stall, a
   slow clock, or a frame landing just after the tick at a short round
   trip), number the next frame after it instead of stepping that frame;
   when a fifth of the snapshots say `late` (averaged over about a
   second), gain half a tick on the frame clock over a quarter second
   (`prediction.ts` `nudgePhase`), once
   per half second at most.

The web page's game client (`apps/web/src/game/`, client-patterns.md) runs
on the page's own socket. `GameSurface` joins with `useJoin`, which runs
the call again on every connection: `watchWorld` always (spectate: full
bootstrap, no spawn; its HUD hears the world), and `joinGame` while the
user plays and is alive (Respawn lets it run again: joinGame spawns a dead
player's snake). The client subscribes the world stream on every hello and
spawns the local snake when its id appears in a snapshot
(`GameClientCore.spawnLocal(null)`). One socket per user. Presence is
room-anchored: a player stays in the sim while any socket of theirs is in
the world's room; gameService's own `onRoomLeave` removes the player (and
sends `playerLeft`) when the last one leaves or disconnects, in every
server the service runs in (the API, the test app, the bench). A party is
the same client over the host's link, on the same socket.

What a client draws of the other snakes is the shared client's
`RemotesMode` (`interpolation.ts`): `playback`, the default, renders them
on the render timeline, 1.5–6 ticks behind the world clock's estimate as
the link needs (the playback delay), interpolating between the snapshots
that bracket the tick; `present` renders them at the estimate of the
server's tick now, the newest snapshot extrapolated along its heading at
its speed (dead reckoning), within a one-way trip of where the server has
them, at the cost of the overshoot a turn brings. Either way every snapshot's arrival glides the
drawn head onto the new path instead of popping. The page takes
`?remotes=playback|present` (A/B play), the bots `BotSpec.remotes` and
`bench:netcode --remotes <mode>`; the ledger has the measured trade.

A server restart is a new world whose ticks start over: the clients (the
page's, the bench bots') tell it from a network blip by the hello's
`serverId`. Every hello anchors the world clock again on the next
snapshot; another server's also forgets what the playback delay learned of
the link (a blip keeps it).

NPCs (`npc-` ids) live inside `GameWorldSim` (seeded, deterministic,
`npcCount` tunable) and reach clients as ordinary remote players; they never
persist scores and don't count toward `humanCount()`. The loop freezes only
when `humanCount() === 0` AND nobody is in the world's room
(`qd.rooms.size(GLOBAL_WORLD_ROOM) > 0`, spectators and anonymous sockets
included) — spectators behind the pre-game dialog keep the NPC world running.

## Host mode: party worlds

A party is a world one player's browser hosts (quickdraw's host mode). The
server keeps the party's row (`GameWorld` with `kind: "party"`, a `code`
of four characters like `K7QD`, `hostUserId`, `closedAt`), its room
(`partyRoom(worldId)`), its chat, and who hosts it. The world itself runs
in the host's page. Its contract members sit beside the world's, never in
place of them: one member is served by the server or by a host, never both.

- **Who is authoritative**: the host's page. It runs `PartyWorld`
  (`packages/shared/src/game/party.ts`: the same `GameWorldSim` and
  `GameLoop` as the server's world) and serves the party with `defineHost`
  (`apps/web/src/components/game/partyHost.ts`) while the server names its
  socket the room's host (`qd:host`). Players reach the host over peer
  links: WebRTC where it connects, the server's relay otherwise (always,
  from a Node client: the bench's host, `check:web`'s). The server never
  sees that traffic.
- **The methods**: `hostParty` (the calling socket joins the room and
  becomes its host; the caller's other open parties end, and one call runs
  at a time per user), `joinParty` by code (the room, the chat and who
  hosts: the world itself comes from the host), `playParty` (for a user the
  room holds: the server tells the room `partyPlayer`, with the name it
  knows, and the host spawns or respawns that snake), `leaveParty`, and
  `closeParty` (the host's: the row policy,
  `anyOf(everyone("Read"), owner("hostUserId"))`, gives a party's host
  Admin on its row; or a service-wide Admin's). A socket is in one party at
  a time (a player's client sends `partyInput` to the first party room
  whose host it knows): hosting, joining or playing takes it out of any
  other party's room. `hostParty` and `joinParty` need a socket.
- **Who gets in**: the code is the invitation. `joinParty` answers
  NOT_FOUND for a code no open party holds (an ended party frees its code)
  and for a party without a host, RATE_LIMITED after ten wrong codes in a
  minute, and CONFLICT when the room holds `PARTY_MAX_USERS` (16) users.
  Only a user the room holds plays in a party or joins its chat
  (`joinWorldChat` refuses the rest), and `getWorld` finds no party.
- **The host-served members**: `partyInput` (a player's input, on the
  link's `fast`, sent every tick as the world's), `partyWorld` (raw
  `WorldSnapshot`s, volatile; its seed is a keyframe) and `partyEvents`
  (joins, leaves, deaths and the leaderboard, reliable on `rel`; its seed
  names every player). Events cannot be host-served, so `partyEvents`
  replaces the world's events in a party. A host spawns a snake only on
  the server's `partyPlayer`: a host-served channel rides the link's
  `fast`, which may lose a one-off command.
- **What the server trusts**: nothing the host reports. No party score is
  stored; the party's leaderboard lives in the host's sim. The server says
  who plays (`partyPlayer`; `partyPlayerLeft` from its `onRoomLeave`, when
  a user's last socket left the room), when the host left (`onHostLeave`:
  `hostLeft`, and the party is closed, since no other player takes over),
  and when the host closed it (`partyClosed`). Both ends take everyone out
  of the room.
- **The Worker timer**: a hidden tab throttles the page's timers to about
  once a second, a dedicated worker's not. The host ticks from a Blob
  worker on `GameLoop`'s fixed grid, so the party keeps its 20 Hz while the
  host looks at another tab.
- **The fair link**: the host's own user plays over a link no network
  slows, and would win every head-to-head. Every 5 s the host page lags
  both of its own user's links (its game's, and its own in-process one) by
  the median of the other players' one-way trips (half of each
  `link.clock.rtt`), at most 100 ms (`settleFairLink` in the shared
  `party.ts`, which the bench's party scenario runs too), with core's
  `PeerLink.setLag`, never an app-level delay. The host's input then
  reaches the sim no sooner than its players', and its snapshots arrive no
  sooner. `?fairLink=off` on `/game` turns it off for A/B play; the HUD
  shows each player's round trip and the lag.
- **The web client**: the page's `useParty` hosts or joins on the page's
  socket, and the same game client plays the party (the canvas is keyed by
  user and world): `PartyWire.tsx` takes `partyWorld` and `partyEvents`
  with `useStream` and sends `partyInput` with `useChannel`, which reach
  the room's host over the link the typed client opens, and hands each
  item to the client's `PartyTransport`, which tells a keyframe (a seed)
  from a snapshot by its send time (a seed has none); a keyframe ask holds
  the world feed off for a moment, so its next subscription answers a fresh
  seed (a `quickdraw-5.0 finding`, with the bridge itself: no React-free
  API for a host-served member yet, so the 20 Hz feed crosses a React
  component, and no refresh for a stream); the dialog respawns with
  `playParty`. Never open a peer link or speak host mode's framing from app
  code.
- **Limits**: a party runs the default tunables (`PARTY_TUNABLES`; admin
  edits of the snake definition reach the server's world only). A server
  restart ends every party (hosts are held in memory): `ensureGlobalWorld`
  closes the rows a previous run left open. A party's chat outlives it.

## Simulation rules

- `GameWorldSim` (`packages/shared/src/game/world.ts`, beside its NPCs,
  its input queue and `GameLoop`) is **pure and deterministic**: no I/O, no
  `Date.now()`, seeded RNG, fixed timestep (`GAME_TICK_RATE`). It imports
  nothing from Node, so the API, the bench and a browser run one sim. Unit
  tests drive it directly; integration tests drive `gameRuntime(db).loop.tickOnce()`
  (the loop is never auto-started in tests).
- **No database access anywhere in the tick path.** Persistence
  (`persistScore`: a new best only) happens in detached `qd.run` units
  triggered by loop callbacks; the tracked write changes the service topic
  the score queries watch.
- A tick that steps a snake several times (its client's backlog) checks
  collisions at every head the snake passed, not only the last, each with
  the heading it had there.
- **Who dies** (`world.ts` `resolveCollisions`, the geometry in
  `collision.ts`): a snake dies only when another snake's path sample or
  true head lies within reach (`headRadius + bodyRadius`) in the front arc
  of its head, `killArcDeg` degrees centred on its heading (a tunable, 180
  by default: the half of the head that faces forward; 360 is the whole
  head). A head that meets the back of another's head, or its neck, kills
  only itself; a head-on kills both. Each death names the snake it met
  (`by`: its id and name) and what of it (`contact`: `"head"` or
  `"body"`, the nearest killing sample's), on the world's `death` event
  and a party's `partyEvents` alike, and the death dialog shows it.
  Self-collision stays off; collisions resolve at the tick's positions (no
  rewind for a player's lag).
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

- `bun run --filter @project/shared test`: the sim, the loop and the
  snapshot codec.
- `bun run --filter @project/api test`: the game over real protocol 5
  sockets (`game.int.test.ts`, its frames matched with `streamFrames` and
  `eventFrames`).
- `bun run check:web`: two real browser pages of the game client in one
  world (Playwright, headless Chromium), through an API restart, then in a
  party a Node client hosts, over the relay
  (`apps/api/src/bench/web-session.ts`; the page's probe, `?probe=1`,
  records what each client sees).
- `bun run --filter @project/api test` covers the party's server half
  (`party.int.test.ts`): the host frame, joins by code, who may link to the
  host, and how a party ends.

## Netcode benchmarking

Netcode changes are judged by scorecards, not eyeballs: `bun run
bench:netcode` runs headless bot clients (`apps/api/src/bench/bot/`: a
behavior and a trace around the shared package's `GameClientCore`,
`packages/shared/src/game/client/`: the netcode the web page runs, one
implementation measured where it is played) over protocol v5 through a
latency proxy against a live-loop server; a party scenario runs them over
loopback links to a host in process. The browser tier (`bun run
bench:web`, `apps/bench-web`) plays the real page and gates what players
feel: frame time p95 and p99 against an acceptance per display rate, long
tasks and geometry builds at zero, on both GPU backends; `bun run
bench:play -- --url <game url>` judges a deployed instance the same way
from a desk. See `docs/netcode-bench.md`, baselines in `bench-baselines/`,
and the `/netcode-rd` skill for the hypothesis loop.

## Scaling note

The sim is single-process in-memory: production deploys must pin the API to
one instance (Cloud Run `max-instances=1`) or move the game to its own service
before scaling out. `qd.rooms.size` counts this process's sockets only.
