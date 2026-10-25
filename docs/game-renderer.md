# Bring your own renderer

The web game client draws with PixiJS 8 (`apps/web/src/game/render/pixi/`).
PixiJS is the default, and nothing here asks you to change it. A fork that
wants another engine (three.js, raw WebGL, canvas2D) replaces that one
folder. The renderer is one interface: the netcode, the frame loop, the
input and the page stay as they are. This guide gives the contract, the
one rule every renderer keeps, the swap, two sketches, and the checks a new
renderer must pass.

It is a guide, not a plugin system: the page runs one renderer, chosen by
one import. On React Native, `docs/react-native.md` puts a native surface
behind the same interface.

## What stays

Everything outside `render/pixi/` is engine-neutral:

- **The netcode**: the shared package's `GameClientCore`
  (`packages/shared/src/game/client/`), with prediction and
  reconciliation, the remote snakes on the world clock, and the food. The
  bench's bots run the same core.
- **The shell** (`apps/web/src/game/shell.ts`): the one
  `requestAnimationFrame` loop. Each display frame it steps the core, aims
  the camera (the local head, or the spectate target) and hands the
  renderer a `RenderFrame`. Every half second it reads `stats()` for the
  debug overlay (`?debug=1`) and the bench.
- **The input** (`input.ts`): the pointer, aimed through the renderer's
  `worldPointAt`.
- **The wire and the page**: `wire/`, `GameCanvas.tsx`, `PartyWire.tsx`,
  the bench telemetry (`bench.ts`) and `check:web`'s probe (`probe.ts`).
- **Three files beside the interface**, in `render/`: `bodyPath.ts` (a
  snake's body, walked back from where its head has been, as the server
  derives it), `palette.ts` (the game's colors, as `0xRRGGBB` numbers that
  tint a white texture) and `spectate.ts` (the camera target before a join
  and after a death). They belong to the game, not to the engine: use them.

## The contract

`GameRenderer` in `apps/web/src/game/render/renderer.ts`, with
`RenderFrame`, `RenderTunables`, `RendererStats` and `RenderBackend`
beside it.

| Method                          | Who calls it, and when                                                 | What it does                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `mount(canvas, { preference })` | The shell, first                                                       | Takes over the canvas (sized to its parent) and resolves once a frame can be drawn. `preference` is the backend `?gpu=` names.    |
| `setPlayers(players)`           | The shell, after the mount, for each join's answer and each new player | Keeps each player's name and hue, and updates a snake already drawn. Data only: a join's answer can arrive before the mount ends. |
| `setBounds(w, h)`               | The shell, once the client joined                                      | Builds the world's border and grid, once per change of the bounds.                                                                |
| `draw(frame)`                   | The shell, once per display frame                                      | Draws the frame and renders it. The engine runs no ticker or loop of its own.                                                     |
| `resetPath(id)`                 | The shell, when a hard snap teleported the local snake                 | Starts that snake's body history over at its next head.                                                                           |
| `worldPointAt(x, y)`            | The pointer input                                                      | Returns the world point under a viewport point, through the camera of the last `draw`.                                            |
| `resize()`                      | `GameCanvas`'s `ResizeObserver`                                        | Fits the drawing buffer to the canvas's new size.                                                                                 |
| `stats()`                       | The shell, every half second                                           | Returns `backend` (the GPU API the engine ended up on), `drawCalls` (null where the backend hides them) and `geometryBuilds`.     |
| `destroy()`                     | The shell, when the client stops                                       | Frees everything the renderer made. It can arrive while `mount` is in flight (React's StrictMode mounts twice in development).    |

A `RenderFrame` holds the local snake (`local`, null while spectating or
dead) and its player's id (`localId`), every remote snake by player id
(`remotes`, at the render tick), the food (`food`, as of the newest
snapshot), the camera target (`camera`, and `snapCamera` to jump there),
the seconds since the client started (`nowS`) and the frame's duration
(`deltaS`). A snake (`RenderedSnake`) is its head (`x`, `y`), its heading
(`dx`, `dy`), its length in segments (`len`) and `boost`.
`RenderTunables` holds what the body walk and the heads need:
`segmentSpacing`, `sampleSpacing`, `headRadius` and `bodyRadius`.

`GameCanvas` gives each client run a canvas of its own and removes it
after `destroy()`, so a renderer may lose its GL context on the way out.

## The one rule

Per-frame work is transform updates only. Nothing geometry-shaped is
built in `draw`: no path tessellated, no texture generated, no text laid
out again unless its string changed. Build at mount (one circle texture
serves everything round), in `setBounds` (the grid) and when a name
changes (its label). In `draw`, write positions, scales and colors into
what exists: a snake that grows takes more sprites or instances from a
pool, never new geometry.

The engine embed this client replaced rebuilt about a thousand circle
polygons a frame in immediate-mode draw calls. A port that does the same
in another engine gives the same stalls.

Two checks hold every renderer to the rule:

- **`stats().geometryBuilds`**: the running count of geometry and textures
  built since mount (a label laid out for a name is not counted). The page
  sends it in its bench telemetry, and `bun run bench:web` gates it:
  `tier2.geometryBuildsPerMin` must be 0 within the measured window. Count
  every build. A renderer that does not count passes a gate it should fail.
- **`apps/web/src/game/__tests__/boundary.test.ts`**: only `render/pixi/`
  imports `pixi.js`, textures are generated in `textures.ts` only, and
  Graphics are built in `textures.ts` and `grid.ts` only. A new engine
  gets the same checks for its own calls.

## What a renderer draws

Keep the game as its players see it:

- **Snakes**: one `BodyPath` (`render/bodyPath.ts`) per snake. Each frame,
  `advance` it with the head and the length, then `segments` walks the
  body back from the head: one segment every `segmentSpacing` px, its
  radius tapering to 70 % at the tail. Place a sprite, an instance or a
  circle at each segment. `resetPath(id)` starts the walk over (`reset` at
  the next head). A snake that a frame leaves out (not in `remotes`, not
  the local one) is gone: drop its view. A snake that comes back is a new
  one, and its path starts at its head.
- **Names and boost**: the local snake (`frame.localId`) carries no name.
  A remote snake shows the name `setPlayers` gave it, laid out again only
  when the name changes. A boosting snake (`boost`) shows its flare.
- **Colors**: `bodyColor(hue)`, `glowColor(hue)`, `darken`, `foodColor(id)`
  and `GAME_BACKGROUND`, from `render/palette.ts`.
- **Food**: each item of `frame.food` (`id`, `x`, `y`, and `v`, the
  segments it gives) appears when it is new and goes when it is gone. Per
  frame only its pulse changes: PixiJS draws it at a radius of
  `3 + 1.5 v` px, wobbling 12 % at 2 rad/s (`render/pixi/food.ts`).
- **The view**: the PixiJS camera (`render/pixi/camera.ts`) scales the
  world to a 720 px tall viewport (zoom = the canvas's height / 720) and
  follows `frame.camera` with exponential smoothing (`1 − e^(−8 Δt)` a
  frame), or jumps there when `snapCamera` is set. Keep that view: another
  zoom shows players another amount of the world. `worldPointAt` inverts
  the same transform.

## Swapping the engine

1. Write `apps/web/src/game/render/<engine>/index.ts`, exporting
   `create<Engine>Renderer(tunables: RenderTunables): GameRenderer`. Keep
   every import of the engine inside that folder.
2. In `apps/web/src/game/GameCanvas.tsx`, change the one import
   (`import { createPixiRenderer } from "./render/pixi";`) and its call in
   `createClient` (`const renderer = createPixiRenderer(inputs.tunables);`).
3. In `apps/web/src/game/__tests__/boundary.test.ts`, point `PIXI_DIR` at
   the new folder and the import pattern at the engine's package. Rewrite
   the two per-frame checks for the engine's own calls (for three.js:
   `new …Geometry(` and new textures, each in one setup file).
4. In `apps/web/package.json`, replace `pixi.js` with the engine and run
   `bun install`. In `scripts/strip-game.mjs`, delete the new package
   where it deletes `pixi.js`, so `init-fork.sh --without-game` still
   drops it.
5. `?gpu=webgl|webgpu` reaches `mount` as `preference`. An engine with both
   backends honors it. An engine with one ignores it: run
   `bench:web --gpu webgl` for its one card. `stats().backend` says what
   ran; a renderer with no GPU API adds its own value to `RenderBackend`
   (`"canvas2d"`), so the card's `tier2.backend` names it.
6. The page's Content Security Policy is Report-Only
   (`apps/web/next.config.mjs`). An engine that needs more (a WASM engine
   needs `'wasm-unsafe-eval'`) adds it to `gameDirectives` there, inside
   the game's markers.
7. Change the copy that names PixiJS (`git grep -i pixi` finds it all):
   the landing page's stack chip
   (`apps/web/src/components/landing/LandingHero.tsx`), its feature text
   (`featGameDesc` in `apps/web/src/messages/en.json`), and the docs.
8. Delete `render/pixi/` when the new renderer passes the checks below.

## Sketch: three.js

- **Mount**: a `WebGLRenderer` on the canvas, or a `WebGPURenderer` (from
  `three/webgpu`) when `preference` is `"webgpu"`. That one falls back to
  WebGL 2 where the browser has no WebGPU: report the backend it ended up
  on. Make the circle texture once, and the meshes below with their
  materials.
- **Camera**: an `OrthographicCamera` over the canvas's size divided by
  the zoom, centered on the smoothed target. The world's y grows
  downward, as on a canvas: write −y into the matrices and negate it back
  in `worldPointAt`, or flip the camera and give the materials
  `side: DoubleSide` (the flip reverses the triangles' winding).
- **Food and segments**: one `InstancedMesh` each for the food, the
  segments, and the glows under each (a `PlaneGeometry` quad with the
  circle texture, `transparent: true`). Per frame, `setMatrixAt` for each
  instance's position and scale, then `instanceMatrix.needsUpdate = true`
  and `mesh.count` for how many to draw. Call `setColorAt` (and set
  `instanceColor.needsUpdate`) only when an instance changes hands. Keep a
  map from food id to instance index, and fill the hole a removed item
  leaves with the last instance.
- **Capacity**: size each mesh at mount for a busy world (`maxFood` in the
  tunables; several long snakes of segments). When one outgrows it, make a
  mesh twice the size and count it as a build: the gate then says the
  capacity was too small.
- **Heads and labels**: another `InstancedMesh` for the heads, their glows
  and their eyes. Each name is one sprite with a `CanvasTexture`, drawn
  when `setPlayers` changes the name, never per frame.
- **Grid**: one `LineSegments` with one `BufferGeometry`, built in
  `setBounds` (a counted build).
- **Stats**: `drawCalls` from `renderer.info.render.calls` after the
  render (WebGL); `geometryBuilds` from your own count.
- **Destroy**: `dispose()` every geometry, material and texture, then the
  renderer.

## Sketch: raw WebGL or canvas2D

- **WebGL 2**: one circle texture, and one buffer of per-instance
  attributes (x, y, radius, color) for everything round. Per frame, write
  the floats into a `Float32Array` made at mount, upload it with one
  `bufferSubData`, and draw each layer (glows, bodies, heads) with one
  `drawArraysInstanced`. The grid is one static buffer, built in
  `setBounds`. This is the one rule at its plainest. Count your own draw
  calls.
- **canvas2D**: one prerendered circle per color, on an offscreen canvas
  made outside `draw`: the food's 360 hues (`foodColor`) at mount, and a
  snake's colors when `setPlayers` names its hue (held until the mount,
  which `setPlayers` can precede). Per frame, one `drawImage` per round
  thing. Nothing geometry-shaped is built, so the gate passes. But each
  round thing costs a call on the main thread: that is fine for a small
  world (a few players, hundreds of segments). `render-stress-8p` (about
  2,800 round things) shows where it breaks: watch `tier2.frameWorkMs`
  and the frame-time tails.

## The checks a new renderer must pass

On a desk with a real display:

1. `bun run test:unit`: the boundary test, rewritten for the new folder.
2. `bun run check:web`: two real pages of the client in one world, through
   an API restart, then a party.
3. `bun run bench:web -- --hz <display>`: the default list, with
   `render-stress-8p` (the renderer's load test), on both backends where
   the engine has them (`--gpu both`, the default). The frame-time tails
   must be within the display's acceptance, and long tasks, geometry
   builds and pauses must be 0. Read `tier2.frameWorkMs` beside PixiJS's
   on the same desk: the work per frame is the headroom the loop has left.
   Add `--runs 3` for numbers you compare.

After a deploy, `bun run bench:play -- --url <game url>` judges the same
renderer from a desk (`docs/netcode-bench.md`).
