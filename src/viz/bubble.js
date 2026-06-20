import {
  Container,
  Graphics,
  Sprite,
  Text,
  Assets,
  ColorMatrixFilter,
  BlurFilter,
} from 'pixi.js';
import { monogramColors, initials, hex } from '../lib/color.js';

/*
 * One person, rendered as a circular bubble.
 *
 *  - A real face if we have one; otherwise a warm, deterministic monogram —
 *    never a grey placeholder (see §1).
 *  - A ring whose colour carries meaning: sage for the living, a dignified
 *    violet for those who've passed (memorial, not greyed-out).
 *  - The face under it is gently de-saturated for the deceased so the wall of
 *    living faces reads first, and the departed are softened but honoured.
 *
 * The bubble is built instantly with its monogram so the tree never waits on
 * network; the photo fades in when (and if) it loads.
 */
export class Bubble {
  constructor(person, baseRadius) {
    this.person = person;
    this.r = baseRadius;
    this.deceased = !!person.is_deceased;
    // Eased display state so bubbles fade/grow in and out as focus moves
    // (the tree starts collapsed to immediate family and expands on tap).
    this.curScale = 0;
    this.curAlpha = 0;

    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    this.root = root;

    // Soft drop shadow — a blurred dark disc behind the bubble.
    const shadow = new Graphics().circle(0, 3, baseRadius + 2).fill({ color: 0x2c2622, alpha: 0.16 });
    shadow.__shadow = true;
    root.addChild(shadow);
    this.shadow = shadow;

    // The portrait container (monogram now, photo later), circularly masked.
    const portrait = new Container();
    root.addChild(portrait);
    this.portrait = portrait;

    const mask = new Graphics().circle(0, 0, baseRadius).fill(0xffffff);
    portrait.addChild(mask);
    portrait.mask = mask;
    this.mask = mask;

    this.drawMonogram();

    // The meaning-bearing ring.
    const ring = new Graphics();
    root.addChild(ring);
    this.ring = ring;
    this.drawRing();

    // Memorial: soften the departed rather than grey them out.
    if (this.deceased) {
      const cm = new ColorMatrixFilter();
      cm.saturate(-0.35, false);
      cm.brightness(1.02, true);
      portrait.filters = [cm];
    }

    this.tryLoadPhoto();
  }

  drawMonogram() {
    const { base, light } = monogramColors(this.person.display_name);
    const r = this.r;
    const g = new Graphics();
    // Soft vertical two-tone so the monogram has depth, not flatness.
    g.circle(0, 0, r).fill(hex(light));
    g.circle(0, r * 0.35, r).fill({ color: hex(base), alpha: 0.55 });
    g.circle(0, 0, r).fill({ color: hex(base), alpha: 0.32 });
    this.portrait.addChild(g);
    this._mono = g;

    const text = new Text({
      text: initials(this.person.display_name),
      style: {
        fontFamily: 'Fraunces, Georgia, serif',
        fontSize: r * 0.78,
        fontWeight: '500',
        fill: 0xfffdf9,
      },
    });
    text.anchor.set(0.5);
    text.resolution = 2;
    this.portrait.addChild(text);
    this._monoText = text;
  }

  drawRing() {
    const r = this.r;
    const ring = this.ring;
    ring.clear();
    if (this.deceased) {
      // A single quiet violet rim — softened and honoured, never greyed out.
      ring.circle(0, 0, r).stroke({ width: 2.5, color: hex('#6b5e7a'), alpha: 0.85 });
    } else {
      // A clean white photo-coin edge. Depth comes from the soft shadow below,
      // not a hard coloured outline.
      ring.circle(0, 0, r).stroke({ width: 3, color: 0xfffdf9, alpha: 1 });
    }
    if (this.person.confidence === 'uncertain') {
      // A faint dotted ring hints "not yet confirmed" without shouting.
      drawDashedCircle(ring, r + 4, 16, { width: 1.2, color: hex('#a89c8e'), alpha: 0.55 });
    }
  }

  async tryLoadPhoto() {
    if (!this.person.photo) return;
    try {
      const tex = await Assets.load(this.person.photo);
      if (this._destroyed) return;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const d = this.r * 2;
      const src = Math.min(tex.width, tex.height) || d;
      sprite.scale.set(d / src);
      sprite.alpha = 0;
      this.portrait.addChild(sprite);
      // Fade the face in over a few frames.
      const fade = () => {
        if (this._destroyed) return;
        sprite.alpha = Math.min(1, sprite.alpha + 0.12);
        if (sprite.alpha < 1) requestAnimationFrame(fade);
        else {
          this._mono?.destroy();
          this._monoText?.destroy();
        }
      };
      requestAnimationFrame(fade);
    } catch {
      /* keep the monogram — a missing face is not a failure state */
    }
  }

  // Called every frame with the bubble's target ego-distance state; the bubble
  // eases toward it so appearing/disappearing is a soft grow/fade, not a pop.
  setVisualState({ scale, alpha, lift, blur }) {
    const k = 0.16;
    this.curScale += (scale - this.curScale) * k;
    this.curAlpha += (alpha - this.curAlpha) * k;
    this.root.visible = this.curAlpha > 0.012;
    this.root.scale.set(this.curScale);
    this.root.alpha = this.curAlpha;
    // Focused/near bubbles lift their shadow a touch for depth.
    this.shadow.alpha = 0.16 * lift * this.curAlpha;
    this.shadow.scale.set(1 + 0.04 * (lift - 1));
    this.setBlur(blur);
  }

  // Distant bubbles recede out of focus. Filter is attached lazily and removed
  // when sharp, so most bubbles carry no filter cost.
  setBlur(amount) {
    if (amount > 0.05) {
      if (!this._blur) this._blur = new BlurFilter({ strength: 0, quality: 2 });
      this._blur.strength = amount;
      if (this.root.filters !== this._blurArr) {
        this._blurArr = [this._blur];
        this.root.filters = this._blurArr;
      }
    } else if (this.root.filters) {
      this.root.filters = null;
      this._blurArr = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.root.destroy({ children: true });
  }
}

function drawDashedCircle(g, radius, segments, style) {
  const gap = 0.45; // fraction of each segment that is empty
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1 - gap) / segments) * Math.PI * 2;
    g.moveTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
    g.arc(0, 0, radius, a0, a1);
  }
  g.stroke(style);
}
