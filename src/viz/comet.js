import { Container, Sprite } from 'pixi.js';
import { warmGlowTexture } from './textures.js';

/*
 * The search flyover's "drone light" — a warm glowing head with a short
 * fading tail that rides at the exact point the camera is centred on during
 * transit, tracing the same Catmull-Rom curve the camera flies. This is what
 * makes the path itself read as *illuminated as you travel it*, rather than
 * the destination just quietly lighting up bubble-by-bubble — the comet is
 * the thing doing the illuminating.
 *
 * Position is pushed in every frame via update(dt, pos); it doesn't know
 * about the flight path itself, just where it's told to be right now. A
 * short history of recent positions drives the trailing sprites, so the
 * tail naturally follows whatever curve the head takes.
 */

const GOLD       = 0xf7c87a;
const CREAM      = 0xfff3e0;
const TAIL_LEN = 6;

export class FlightComet {
  constructor(baseRadius) {
    this.r = baseRadius;
    this.t = 0;
    this.history = []; // recent {x,y}, newest first

    const root = new Container();
    root.eventMode = 'none';
    this.root = root;

    this.head = new Sprite(warmGlowTexture());
    this.head.anchor.set(0.5);
    this.head.blendMode = 'add';
    this.head.tint = CREAM;
    root.addChild(this.head);

    this.tail = [];
    for (let i = 0; i < TAIL_LEN; i++) {
      const s = new Sprite(warmGlowTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = GOLD;
      s.alpha = 0;
      root.addChild(s);
      this.tail.push(s);
    }
  }

  update(dt, pos) {
    this.t += dt;
    this.history.unshift({ x: pos.x, y: pos.y });
    if (this.history.length > TAIL_LEN + 1) this.history.length = TAIL_LEN + 1;

    // A gentle pulse on the head so it reads as "alive" rather than a static dot.
    const pulse = 1 + Math.sin(this.t * 5.5) * 0.12;
    this.head.width = this.head.height = this.r * 0.85 * pulse;
    this.head.alpha = 0.9;
    this.head.position.set(pos.x, pos.y);

    for (let i = 0; i < this.tail.length; i++) {
      const h = this.history[i + 1];
      const sp = this.tail[i];
      if (!h) { sp.alpha = 0; continue; }
      const f = 1 - i / this.tail.length; // 1 (near head) -> 0 (far)
      sp.position.set(h.x, h.y);
      sp.width = sp.height = this.r * (0.6 * f + 0.15);
      sp.alpha = f * 0.5;
    }
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
