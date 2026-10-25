/**
 * The food: one particle per item in two particle
 * containers (the glows under the bodies), from the one circle texture.
 * Items are added and removed as the food held changes; per frame only the
 * pulse writes each particle's scale.
 */

import { Particle, ParticleContainer, type Texture } from "pixi.js";
import type { FoodDTO } from "@project/shared";
import { foodColor } from "../palette";
import { scaleFor } from "./textures";

interface FoodView {
  glow: Particle;
  body: Particle;
  /** A food item's radius: 3 + v * 1.5 */
  radius: number;
  /** The frame that last saw the item; an item a frame did not see is gone. */
  stamp: number;
}

export class FoodLayer {
  public readonly glow: ParticleContainer<Particle>;
  public readonly body: ParticleContainer<Particle>;
  private readonly items = new Map<string, FoodView>();
  private stamp = 0;

  constructor(private readonly texture: Texture) {
    // positions and colors are set once per item; only the scale pulses
    const dynamicProperties = {
      position: false,
      scale: true,
      rotation: false,
      uvs: false,
      color: false,
      vertex: false,
    };
    this.glow = new ParticleContainer<Particle>({ texture, dynamicProperties });
    this.body = new ParticleContainer<Particle>({ texture, dynamicProperties });
  }

  /** The food held now: adds what is new, drops what is gone, pulses the rest. */
  public sync(food: readonly FoodDTO[], nowS: number): void {
    this.stamp += 1;
    // wobble = 1 + 0.12 * sin(pulse), the pulse at 2 rad/s
    const wobble = 1 + 0.12 * Math.sin(nowS * 2);
    for (const item of food) {
      let view = this.items.get(item.id);
      if (view === undefined) {
        view = this.add(item);
        this.items.set(item.id, view);
      }
      view.stamp = this.stamp;
      const r = view.radius * wobble;
      view.body.scaleX = view.body.scaleY = scaleFor(r);
      view.glow.scaleX = view.glow.scaleY = scaleFor(r + 2);
    }
    if (this.items.size === food.length) return;
    for (const [id, view] of this.items) {
      if (view.stamp === this.stamp) continue;
      this.glow.removeParticle(view.glow);
      this.body.removeParticle(view.body);
      this.items.delete(id);
    }
  }

  private add(item: FoodDTO): FoodView {
    const tint = foodColor(item.id);
    const radius = 3 + item.v * 1.5;
    const common = {
      texture: this.texture,
      x: item.x,
      y: item.y,
      anchorX: 0.5,
      anchorY: 0.5,
      tint,
    };
    const glow = new Particle({
      ...common,
      alpha: 0.25,
      scaleX: scaleFor(radius + 2),
      scaleY: scaleFor(radius + 2),
    });
    const body = new Particle({ ...common, scaleX: scaleFor(radius), scaleY: scaleFor(radius) });
    this.glow.addParticle(glow);
    this.body.addParticle(body);
    return { glow, body, radius, stamp: this.stamp };
  }

  public destroy(): void {
    this.items.clear();
    this.glow.destroy();
    this.body.destroy();
  }
}
