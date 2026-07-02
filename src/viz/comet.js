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
 *
 * It also leaves a faint trail of smoke behind it — not additive-blended
 * like the glow, so it reads as something drifting in front of the tree
 * rather than more light — spawned periodically at the head's position and
 * left to rise and dissipate independently, well after the head has moved on.
 */

const GOLD       = 0xf7c87a;
const CREAM      = 0xfff3e0;
const SMOKE      = 0x8a7d70; // warm-grey, not pure black — an ember's smoke, not soot
const TAIL_LEN = 6;
const SMOKE_SPAWN_MS = 110; // a new puff roughly every ~9/s while moving
const SMOKE_LIFE = 1.7;     // s a puff drifts + fades before it's gone

export class FlightComet {
  constructor(baseRadius) {
    this.r = baseRadius;
    this.t = 0;
    this.history = []; // recent {x,y}, newest first
    this.smoke = [];   // {sprite, age, drift:{x,y}, seed}
    this.sinceSpawn = 0;

    const root = new Container();
    root.eventMode = 'none';
    this.root = root;

    // Smoke drawn first (furthest back) so the bright head/tail sit on top of it.
    this.smokeLayer = new Container();
    root.addChild(this.smokeLayer);

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

    // ── Smoke wisps — the "burning path" trailing behind the light ─────────
    // Not additive: real smoke doesn't glow, it occludes softly, so a normal
    // (non-additive) blend against the cream backdrop reads right.
    this.sinceSpawn += dt * 1000;
    if (this.sinceSpawn >= SMOKE_SPAWN_MS) {
      this.sinceSpawn = 0;
      const sp = new Sprite(warmGlowTexture());
      sp.anchor.set(0.5);
      sp.tint = SMOKE;
      sp.position.set(pos.x, pos.y);
      this.smokeLayer.addChild(sp);
      this.smoke.push({
        sprite: sp,
        age: 0,
        driftX: (Math.random() - 0.5) * this.r * 0.6,
        driftY: -this.r * (0.9 + Math.random() * 0.6), // smoke rises
      });
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      const lp = Math.min(1, p.age / SMOKE_LIFE);
      if (lp >= 1) {
        p.sprite.destroy();
        this.smoke.splice(i, 1);
        continue;
      }
      p.sprite.position.x += p.driftX * dt;
      p.sprite.position.y += p.driftY * dt;
      p.sprite.width = p.sprite.height = this.r * (0.5 + lp * 1.3);
      // Fades in quickly, lingers, then dissipates — never more than a whisper.
      p.sprite.alpha = Math.sin(Math.min(1, lp * 3.2) * Math.PI * 0.5) * (1 - lp) * 0.22;
    }
  }

  destroy() {
    // root.destroy({ children: true }) recursively destroys smokeLayer and
    // any still-living puffs inside it — no need to destroy them separately.
    this.smoke = [];
    this.root.destroy({ children: true });
  }
}
