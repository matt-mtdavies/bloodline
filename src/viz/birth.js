import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { warmGlowTexture } from './textures.js';
import { hex } from '../lib/color.js';

/*
 * The time-view birth animation — "a new light arrives."
 *
 * When the timeline crosses a person's birth year, a birth is *celebrated*
 * rather than merely shown. The choreography, deliberately slowed down so it
 * reads as an event:
 *
 *   A. Descent (0 → 0.65s)  A glowing mote falls from the parents' midpoint
 *      (or rises from below, for a root) to the child's place, trailing a
 *      warm comet tail. The bubble itself is still unseen.
 *   B. Bloom   (0.55 → 1.5s) The mote bursts: a bright flash, three staggered
 *      halo rings expanding and fading, and the bubble pops into being with an
 *      elastic overshoot while a soft glow swells behind it.
 *   C. Motes   (1.0 → 2.6s)  A handful of warm embers drift up and outward and
 *      fade, like seeds on the wind — life settling into the tree.
 *   D. Year    (1.5 → 2.9s)  Once the face is settled and visible, the birth
 *      year emerges from the bubble, growing and fading as it goes — with
 *      several births landing close together on the timeline it's otherwise
 *      hard to tell which bubble just arrived and what year it happened in;
 *      this ties the two together explicitly. Only rendered when a year is
 *      given — the recap tour reuses this same effect for its own "what
 *      changed" bloom, where there's no birth year to show.
 *
 * The effect owns the bubble's scale/alpha through phases A–B (so the pop is
 * synced to the bloom), then hands control back seamlessly once settled. All
 * luminous parts use additive blending for a glow that sings on the cream
 * ground; the year text is a normal (non-additive) solid fill so it stays
 * legible rather than washing out. The whole thing self-cleans when done.
 */

const GOLD       = 0xf7c87a;
const TERRACOTTA = 0xc2603a;
const CREAM      = 0xfff3e0;
const TREE_FONT  = 'Hanken Grotesk, system-ui, sans-serif';

const DESCENT_DUR = 0.65;   // s — mote falls into place
const POP_AT      = 0.55;   // s — bubble starts to appear (overlaps descent end)
const POP_DUR     = 0.72;   // s — elastic pop duration
const SETTLE_AT   = POP_AT + POP_DUR + 0.05; // hand bubble back to normal control
const YEAR_DELAY  = 0.18;   // s after settle before the year starts emerging
const YEAR_START  = SETTLE_AT + YEAR_DELAY;
const YEAR_DUR    = 1.4;    // s — grows + fades over this long (~1-2s, per design)
const TOTAL       = YEAR_START + YEAR_DUR + 0.2; // s — full effect lifetime

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutCubic   = (x) => 1 - Math.pow(1 - x, 3);
// easeOutBack — a single clean overshoot above 1.0 then settle.
const easeOutBack = (x) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class BirthEffect {
  /*
   * dest      {x,y}   world position of the new person's bubble
   * origin    {x,y}   where the light descends from (parents' midpoint, or
   *                   just above `dest` for a person with no visible parents)
   * baseRadius        the bubble radius, so the bloom scales with the tree
   * birthYear number|null  when given, the year emerges from the bubble
   *                   after it settles (phase D); omitted entirely for the
   *                   recap tour's reuse of this effect, which isn't a birth
   */
  constructor(dest, origin, baseRadius, birthYear = null) {
    this.dest = dest;
    this.origin = origin;
    this.r = baseRadius;
    this.t = 0;
    this.done = false;
    this.bubbleSettled = false; // once true, the loop resumes normal control

    const root = new Container();
    root.eventMode = 'none';
    root.position.set(0, 0);
    this.root = root;

    // ── Descending mote + trail ───────────────────────────────────────────
    this.trail = [];
    for (let i = 0; i < 5; i++) {
      const t = new Sprite(warmGlowTexture());
      t.anchor.set(0.5);
      t.blendMode = 'add';
      t.tint = i === 0 ? CREAM : GOLD;
      t.alpha = 0;
      root.addChild(t);
      this.trail.push(t);
    }

    // ── Bloom: flash + halo rings (Graphics, additive) ────────────────────
    this.flash = new Sprite(warmGlowTexture());
    this.flash.anchor.set(0.5);
    this.flash.blendMode = 'add';
    this.flash.tint = CREAM;
    this.flash.alpha = 0;
    this.flash.position.set(dest.x, dest.y);
    root.addChild(this.flash);

    this.halos = new Graphics();
    this.halos.blendMode = 'add';
    root.addChild(this.halos);

    // ── Soft glow that swells behind the bubble during the pop ────────────
    this.bubbleGlow = new Sprite(warmGlowTexture());
    this.bubbleGlow.anchor.set(0.5);
    this.bubbleGlow.blendMode = 'add';
    this.bubbleGlow.tint = GOLD;
    this.bubbleGlow.alpha = 0;
    this.bubbleGlow.position.set(dest.x, dest.y);
    root.addChild(this.bubbleGlow);

    // ── Drifting life-motes ───────────────────────────────────────────────
    this.motes = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const s = new Sprite(warmGlowTexture());
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = i % 2 ? GOLD : TERRACOTTA;
      s.alpha = 0;
      root.addChild(s);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1; // upward-biased
      this.motes.push({
        sprite: s,
        ang,
        speed: baseRadius * (1.6 + Math.random() * 1.8),
        size: baseRadius * (0.18 + Math.random() * 0.22),
        delay: 0.45 + Math.random() * 0.5,
        wob: Math.random() * Math.PI * 2,
      });
    }

    // ── Birth year, emerging from the settled bubble (phase D) ────────────
    // Solid fill, not additive — this needs to stay readable, not glow and
    // wash out against the pale canvas the way the light-effects above do.
    if (birthYear != null) {
      const yr = new Text({
        text: String(birthYear),
        style: {
          fontFamily: TREE_FONT,
          fontSize: Math.round(baseRadius * 0.85),
          fontWeight: '700',
          fill: '#c2603a',
          letterSpacing: 0.5,
        },
      });
      yr.anchor.set(0.5);
      yr.resolution = 2;
      yr.alpha = 0;
      yr.position.set(dest.x, dest.y);
      root.addChild(yr);
      this.yearText = yr;
    } else {
      this.yearText = null;
    }
  }

  // The bubble's entrance, derived from the effect clock. Returns a scale
  // multiplier (0 → overshoot → 1) and alpha (0 → 1). The loop multiplies the
  // bubble's normal target scale by `scale` so the pop settles onto the
  // correct focus size with no hand-off jump.
  bubbleEntrance() {
    const t = this.t;
    if (t < POP_AT) return { scale: 0, alpha: 0 };
    const p = clamp01((t - POP_AT) / POP_DUR);
    return { scale: easeOutBack(p), alpha: easeOutCubic(clamp01((t - POP_AT) / (POP_DUR * 0.5))) };
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const r = this.r;

    if (t >= SETTLE_AT) this.bubbleSettled = true;

    // ── A. Descent ────────────────────────────────────────────────────────
    if (t < DESCENT_DUR + 0.05) {
      const p = clamp01(t / DESCENT_DUR);
      const e = easeInOutCubic(p);
      const x = this.origin.x + (this.dest.x - this.origin.x) * e;
      const y = this.origin.y + (this.dest.y - this.origin.y) * e;
      // Head + trailing tail: each trail sprite lags a little behind the head.
      for (let i = 0; i < this.trail.length; i++) {
        const lag = i * 0.045;
        const pe = easeInOutCubic(clamp01((t - lag) / DESCENT_DUR));
        const tx = this.origin.x + (this.dest.x - this.origin.x) * pe;
        const ty = this.origin.y + (this.dest.y - this.origin.y) * pe;
        const sp = this.trail[i];
        const size = r * (i === 0 ? 0.95 : 0.7 - i * 0.1);
        sp.width = sp.height = Math.max(2, size * 2);
        sp.position.set(tx, ty);
        // Fade the whole comet out as it arrives so the bloom takes over.
        const arrive = 1 - clamp01((t - DESCENT_DUR * 0.8) / (DESCENT_DUR * 0.3));
        sp.alpha = (i === 0 ? 0.95 : 0.5 - i * 0.08) * arrive;
      }
    } else {
      for (const sp of this.trail) sp.alpha = 0;
    }

    // ── B. Bloom: flash + halos + bubble glow ─────────────────────────────
    // Central flash — a quick bright burst right as the mote lands.
    const fp = clamp01((t - POP_AT + 0.05) / 0.45);
    if (fp > 0 && fp < 1) {
      this.flash.width = this.flash.height = r * (1.2 + fp * 3.2);
      this.flash.alpha = (1 - fp) * 0.9;
    } else {
      this.flash.alpha = 0;
    }

    // Three staggered halo rings expanding outward and fading.
    this.halos.clear();
    for (let i = 0; i < 3; i++) {
      const delay = POP_AT + i * 0.13;
      const hp = clamp01((t - delay) / 0.9);
      if (hp <= 0 || hp >= 1) continue;
      const e = easeOutCubic(hp);
      const radius = r * (0.5 + e * 2.6);
      const alpha = (1 - hp) * 0.5;
      const color = i === 0 ? CREAM : i === 1 ? GOLD : TERRACOTTA;
      this.halos
        .circle(this.dest.x, this.dest.y, radius)
        .stroke({ width: r * 0.16 * (1 - hp) + 1, color: hex('#' + color.toString(16).padStart(6, '0')), alpha });
    }

    // Soft glow swelling behind the bubble during the pop, then easing away.
    const gp = clamp01((t - POP_AT) / 1.0);
    if (gp > 0 && gp < 1) {
      const swell = Math.sin(gp * Math.PI); // 0 → 1 → 0
      this.bubbleGlow.width = this.bubbleGlow.height = r * (3 + swell * 2.2);
      this.bubbleGlow.alpha = swell * 0.6;
    } else {
      this.bubbleGlow.alpha = 0;
    }

    // ── C. Drifting life-motes ────────────────────────────────────────────
    for (const m of this.motes) {
      const lt = t - m.delay;
      if (lt <= 0) { m.sprite.alpha = 0; continue; }
      const life = 1.3;
      const lp = clamp01(lt / life);
      if (lp >= 1) { m.sprite.alpha = 0; continue; }
      const dist = m.speed * easeOutCubic(lp);
      const buoy = -r * 0.9 * lp * lp;          // gentle rise
      const wob = Math.sin(m.wob + lt * 4) * r * 0.18 * (1 - lp); // wander
      m.sprite.position.set(
        this.dest.x + Math.cos(m.ang) * dist + wob,
        this.dest.y + Math.sin(m.ang) * dist + buoy,
      );
      const sz = m.size * (1.1 - lp * 0.7);
      m.sprite.width = m.sprite.height = Math.max(1, sz * 2);
      m.sprite.alpha = Math.sin(lp * Math.PI) * 0.85;
    }

    // ── D. Birth year emerging from the settled bubble ────────────────────
    if (this.yearText) {
      const yp = clamp01((t - YEAR_START) / YEAR_DUR);
      if (t < YEAR_START || t > YEAR_START + YEAR_DUR) {
        this.yearText.alpha = 0;
      } else {
        const growth = easeOutCubic(yp);
        const scale = 0.65 + growth * 1.45; // 0.65 -> 2.1, "coming out" of the bubble
        this.yearText.scale.set(scale);
        // Hold at full opacity briefly so the number has a moment to actually
        // be read before it starts dissolving, rather than fading from the
        // instant it appears.
        const fadeP = clamp01((yp - 0.2) / 0.8);
        this.yearText.alpha = 1 - easeInOutCubic(fadeP);
        this.yearText.position.set(this.dest.x, this.dest.y - r * 0.35 * growth);
      }
    }

    if (t >= TOTAL) this.done = true;
  }

  destroy() {
    this.root.destroy({ children: true });
  }
}
