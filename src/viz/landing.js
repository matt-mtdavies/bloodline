import { Container, Sprite, Graphics } from 'pixi.js';
import { warmGlowTexture } from './textures.js';
import { hex } from '../lib/color.js';

/*
 * The search flyover's arrival beat — "you've found them." A quick bright
 * flash, two staggered halo rings expanding outward, and a soft glow swell,
 * all centred on the destination bubble. Lighter and snappier than the time
 * view's BirthEffect (no descent, no motes, no bubble entrance) since this
 * plays on an already-visible bubble after every search flight, not just
 * once per person born.
 */

const CREAM      = 0xfff3e0;
const TERRACOTTA = 0xc2603a;
const TOTAL = 0.65; // s — full effect lifetime

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class LandingBurst {
  constructor(dest, baseRadius) {
    this.t = 0;
    this.done = false;
    this.r = baseRadius;

    const root = new Container();
    root.eventMode = 'none';
    this.root = root;

    this.flash = new Sprite(warmGlowTexture());
    this.flash.anchor.set(0.5);
    this.flash.blendMode = 'add';
    this.flash.tint = CREAM;
    this.flash.alpha = 0;
    this.flash.position.set(dest.x, dest.y);
    root.addChild(this.flash);

    this.glow = new Sprite(warmGlowTexture());
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = TERRACOTTA;
    this.glow.alpha = 0;
    this.glow.position.set(dest.x, dest.y);
    root.addChild(this.glow);

    this.halos = new Graphics();
    this.halos.blendMode = 'add';
    root.addChild(this.halos);
    this.dest = dest;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const r = this.r;

    const fp = clamp01(t / 0.3);
    this.flash.width = this.flash.height = r * (1.1 + fp * 2.4);
    this.flash.alpha = fp < 1 ? (1 - fp) * 0.85 : 0;

    const gp = clamp01(t / 0.5);
    const swell = Math.sin(gp * Math.PI);
    this.glow.width = this.glow.height = r * (2.6 + swell * 1.6);
    this.glow.alpha = swell * 0.5;

    this.halos.clear();
    for (let i = 0; i < 2; i++) {
      const delay = i * 0.1;
      const hp = clamp01((t - delay) / 0.55);
      if (hp <= 0 || hp >= 1) continue;
      const e = easeOutCubic(hp);
      const radius = r * (0.6 + e * 2.2);
      const alpha = (1 - hp) * 0.55;
      this.halos
        .circle(this.dest.x, this.dest.y, radius)
        .stroke({ width: r * 0.14 * (1 - hp) + 1, color: hex(i === 0 ? '#fff3e0' : '#c2603a'), alpha });
    }

    if (t >= TOTAL) this.done = true;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
