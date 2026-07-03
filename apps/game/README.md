# @project/game — Godot client

The Godot 4.7 project for the demo game (slither-style snake against the
`gameService` world). It talks to the API over the same quickdraw Socket.IO
protocol as the web app, via the first-party GDScript client in
`godot/addons/quickdraw/quickdraw_client.gd` (websocket transport only).

Not a game project? Remove all of this with
`./scripts/init-fork.sh <name> --without-game`.

## Editor setup

```bash
brew install godot          # 4.7+ (macOS; see godotengine.org otherwise)
godot godot/project.godot   # open the project
```

### Dev auth (running the game from the editor)

The editor build authenticates with the API's dev credentials
(`ENABLE_DEV_CREDENTIALS=true`, the local default). Point it at a seeded user:

```bash
# One-off: grab a demo user id
cd ../.. && ./scripts/load-env.sh bun -e \
  'import {prisma} from "./packages/db/dist/index.js"; \
   console.log((await prisma.user.findFirst({where:{email:"user@demo.local"}})).id); \
   await prisma.$disconnect()'

# Then either export env vars before launching Godot…
QUICKDRAW_DEV_USER_ID=<id> QUICKDRAW_API_URL=http://localhost:4000 godot godot/project.godot

# …or create the persistent config the game reads at boot:
#   user://dev.json  →  {"user_id": "<id>", "api_url": "http://localhost:4000"}
# (user:// is ~/Library/Application Support/Godot/app_userdata/Quickdraw Snake/ on macOS)
```

Start the API first (`bun run dev` at the repo root), then run the game
(F5 in the editor). Open http://localhost:3000/game in a browser at the same
time — you'll see both snakes in the shared world.

## Architecture

```
addons/quickdraw/quickdraw_client.gd   Socket.IO v4 client (WS-only): call_method /
                                       subscribe / send_channel / on_event, reconnect
scripts/autoload/net.gd                Host config (web bridge vs editor dev) + connection
scripts/autoload/game.gd               subscribe → joinGame → events fan-out (ordering contract)
scripts/game_config.gd                 Movement tunables + shared sim_step — MUST mirror
                                       apps/api/src/services/game/world.ts
scripts/local_snake.gd                 Client-side prediction + reconciliation (ack replay,
                                       decaying visual offset — no rubber-banding)
scripts/remote_snake.gd                Snapshot-buffer interpolation (~125ms render delay)
scripts/snake_body.gd                  Body derived from head-path history (matches server)
scripts/main.gd                        World bootstrap, snapshot routing, minimal in-canvas UI
```

The netcode contract lives in `packages/shared/src/types/game.ts` and
`.claude/rules/game-patterns.md`. Commands (join/respawn/anything gameplay-
adjacent you add) are ordinary quickdraw methods — a React button and GDScript
call them identically. Only tick-rate traffic uses channels.

## Web export

```bash
bun run export        # from apps/game (or ./export-web.sh)
```

Exports into `apps/web/public/game/` (committed): `index.js` (engine loader),
`index.wasm` (~38MB engine, changes only on Godot upgrades), `index.pck`
(game data, small), and `engine-config.json` (extracted for the React
wrapper). The wrapper (`apps/web/src/components/game/GodotCanvas.tsx`)
direct-embeds the engine into the page — no iframe — so MUI overlays float
above the canvas and Discord's proxy can rewrite paths.

Export templates: download the matching version once —
`https://github.com/godotengine/godot/releases/download/4.7-stable/Godot_v4.7-stable_export_templates.tpz`,
unzip `templates/web_*` into
`~/Library/Application Support/Godot/export_templates/4.7.stable/`.

### Why the non-threaded export

`variant/thread_support=false` means no SharedArrayBuffer, so the page needs
no COOP/COEP headers. That keeps cross-origin images working and stays
compatible with the Discord Activity proxy. Single-threaded wasm is plenty for
2D games. If you need threads, flip the preset option and add to
`apps/web/next.config.mjs`:

```js
headers: async () => [{
  source: "/game/:path*",
  headers: [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  ],
}],
```

(and serve the page itself with those headers too — at which point embedded
cross-origin assets need CORP headers; this is why the default is off).

## Adding gameplay

1. New command → `defineMethod` on GameService + type in
   `packages/shared/src/types/game.ts` → call from GDScript with
   `await Net.client.call_method("gameService", "myMethod", {...})` or from
   React with `useService("gameService", "myMethod")`. Same call, same ACL.
2. New high-frequency stream → `defineChannel` server-side +
   `Net.client.send_channel(...)`.
3. Movement/balance changes → update `world.ts` AND `game_config.gd`
   (until the DefinitionService phase makes the server the single source).
