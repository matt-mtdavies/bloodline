import { Container, Sprite, Graphics } from 'pixi.js';
import { warmGlowTexture } from './textures.js';
import { hex } from '../lib/color.js';

/*
 * The search flyover's per-bubble "coming to life" flourish — a quick warm
 * spark right as the drone's route reaches someone, distinct from both the
 * time view's BirthEffect (a whole ceremony, once per person ever) and the
 * flyover's own LandingBurst (a single punch at the final destination only).
 * This one has to be light enough to fire several times in a few seconds as
 * the camera glides past each hop without ever feeling like it's competing
 * with itself — a single flash + one expanding ring, done in just over half
 * a second.
 */

const GOLD       = 0xf7c87a;
const TERRACOTTA = 0xc2603a;
const TOTAL = 0.6; // s

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class IgniteEffect {
  constructor(dest, baseRadius) {
    this.t = 0;
    this.done = false;
    this.r = baseRadius;
    this.dest = dest;

    const root = new Container();
    root.eventMode = 'none';
    this.root = root;

    this.flash = new Sprite(warmGlowTexture());
    this.flash.anchor.set(0.5);
    this.flash.blendMode = 'add';
    this.flash.tint = GOLD;
    this.flash.alpha = 0;
    this.flash.position.set(dest.x, dest.y);
    root.addChild(this.flash);

    this.ring = new Graphics();
    this.ring.blendMode = 'add';
    root.addChild(this.ring);
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const r = this.r;

    const fp = clamp01(t / 0.28);
    this.flash.width = this.flash.height = r * (1.0 + fp * 1.8);
    this.flash.alpha = fp < 1 ? (1 - fp) * 0.8 : 0;

    this.ring.clear();
    const rp = clamp01(t / 0.55);
    if (rp > 0 && rp < 1) {
      const e = easeOutCubic(rp);
      const radius = r * (0.7 + e * 1.5);
      this.ring
        .circle(this.dest.x, this.dest.y, radius)
        .stroke({ width: r * 0.12 * (1 - rp) + 1, color: hex('#' + TERRACOTTA.toString(16).padStart(6, '0')), alpha: (1 - rp) * 0.6 });
    }

    if (t >= TOTAL) this.done = true;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
