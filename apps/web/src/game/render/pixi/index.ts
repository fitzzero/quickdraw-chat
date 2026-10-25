/**
 * The PixiJS 8 renderer behind `GameRenderer`: the only folder in
 * `apps/web/src/game` that imports `pixi.js`. One circle texture for
 * everything round, particles for the food and the body segments, sprites
 * for the heads, one Graphics for the grid built once per change of the
 * bounds, a camera container; per frame, transforms only. Pixi batches the
 * lot into a few draw calls, which `stats()` counts on WebGL.
 */

import { Application, Container, type Texture } from "pixi.js";
import type { GamePlayerMeta } from "@project/shared";
import type {
  GameRenderer,
  RenderBackend,
  RenderFrame,
  RendererStats,
  RenderTunables,
} from "../renderer";
import { Camera } from "./camera";
import { installDrawCallCounter, type DrawCallCounter } from "./drawCalls";
import { FoodLayer } from "./food";
import { Grid } from "./grid";
import { SnakeView } from "./snakes";
import { makeCircleTexture } from "./textures";
import { GAME_BACKGROUND } from "../palette";

export function createPixiRenderer(tunables: RenderTunables): GameRenderer {
  return new PixiRenderer(tunables);
}

class PixiRenderer implements GameRenderer {
  private app: Application | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private texture: Texture | null = null;
  private counter: DrawCallCounter | null = null;
  private food: FoodLayer | null = null;
  private readonly camera = new Camera();
  private readonly grid: Grid;
  /** Every snake's segments, then every head above them: a draw call a snake, one for all the heads. */
  private readonly segmentsLayer = new Container();
  private readonly headsLayer = new Container();
  private readonly snakes = new Map<string, SnakeView>();
  private readonly players = new Map<string, GamePlayerMeta>();
  private builds = 0;
  private lastDrawCalls: number | null = null;
  private stamp = 0;
  /** The local player: their own snake carries no name label (snake_body.gd's local setup). */
  private localId: string | null = null;
  /** `destroy()` ran: a mount still in flight tears its engine down instead of finishing. */
  private destroyed = false;

  constructor(private readonly tunables: RenderTunables) {
    this.grid = new Grid(() => this.countBuild());
  }

  public async mount(
    canvas: HTMLCanvasElement,
    options: { preference?: RenderBackend },
  ): Promise<void> {
    const app = new Application();
    await app.init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
      backgroundColor: GAME_BACKGROUND,
      // the shell's frame loop renders; no ticker of the engine's
      autoStart: false,
      sharedTicker: false,
      ...(options.preference === undefined ? {} : { preference: options.preference }),
    });
    if (this.destroyed) {
      // stopped while the engine was starting (React's StrictMode mounts
      // twice in development): nothing of this run may stay alive
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
      return;
    }
    this.app = app;
    this.canvas = canvas;
    this.counter = installDrawCallCounter(app.renderer);
    this.texture = makeCircleTexture(app.renderer);
    this.countBuild();
    this.food = new FoodLayer(this.texture);
    this.camera.world.addChild(
      this.grid.view,
      this.food.glow,
      this.food.body,
      this.segmentsLayer,
      this.headsLayer,
    );
    app.stage.addChild(this.camera.world);
  }

  public resize(): void {
    this.app?.resize();
  }

  public setBounds(w: number, h: number): void {
    this.grid.setBounds(w, h);
  }

  public setPlayers(players: Iterable<GamePlayerMeta>): void {
    for (const meta of players) {
      const known = this.players.get(meta.id);
      this.players.set(meta.id, meta);
      const view = this.snakes.get(meta.id);
      if (view === undefined) continue;
      view.setName(meta.id === this.localId ? "" : (meta.name ?? ""));
      if (known?.hue !== meta.hue) view.setHue(meta.hue);
    }
  }

  public draw(frame: RenderFrame): void {
    const { app, food } = this;
    if (app === null || food === null) return;
    this.stamp += 1;
    this.localId = frame.localId;
    const { width, height } = app.renderer.screen;
    this.camera.update(frame.camera, frame.snapCamera, frame.deltaS, width, height);
    food.sync(frame.food, frame.nowS);
    for (const [id, snake] of frame.remotes) this.view(id).update(snake);
    if (frame.local !== null && frame.localId !== null) {
      this.view(frame.localId).update(frame.local);
    }
    for (const [id, view] of this.snakes) {
      if (view.stamp === this.stamp) continue;
      view.destroy();
      this.snakes.delete(id);
    }
    this.counter?.begin();
    app.render();
    this.lastDrawCalls = this.counter?.end() ?? null;
  }

  /** The snake's view, made on its first frame (a spawn: its path starts there). */
  private view(id: string): SnakeView {
    let view = this.snakes.get(id);
    if (view === undefined) {
      const meta = this.players.get(id);
      const name = id === this.localId ? "" : (meta?.name ?? "");
      view = new SnakeView(this.texture as Texture, meta?.hue ?? 0, name, this.tunables);
      this.segmentsLayer.addChild(view.segments);
      this.headsLayer.addChild(view.head);
      this.snakes.set(id, view);
    }
    view.stamp = this.stamp;
    return view;
  }

  public resetPath(id: string): void {
    this.snakes.get(id)?.resetPath();
  }

  public worldPointAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return this.camera.worldPoint(clientX - rect.left, clientY - rect.top);
  }

  public stats(): RendererStats {
    return {
      backend: this.counter?.backend ?? null,
      drawCalls: this.lastDrawCalls,
      geometryBuilds: this.builds,
    };
  }

  private countBuild(): void {
    this.builds += 1;
  }

  public destroy(): void {
    this.destroyed = true;
    for (const view of this.snakes.values()) view.destroy();
    this.snakes.clear();
    this.food?.destroy();
    this.food = null;
    // The canvas is this run's own (GameCanvas makes one per client), and
    // destroying the engine loses its GL context: it leaves the page with it
    this.app?.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    this.app = null;
    this.texture = null;
  }
}
