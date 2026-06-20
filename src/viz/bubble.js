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
import { softShadowTexture } from './textures.js';
import { Spring } from '../lib/spring.js';

const TREE_FONT = 'Hanken Grotesk, system-ui, sans-serif';

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
    // Eased display state. Scale springs (with a little overshoot) so bubbles
    // pop in when revealed; alpha eases so they fade cleanly.
    this.scaleSpring = new Spring(0, { stiffness: 150, damping: 14 });
    this.curAlpha = 0;

    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    this.root = root;

    // Soft, blurred, modern drop shadow (a reused gradient sprite) so the
    // bubble floats on the white ground.
    const shadow = new Sprite(softShadowTexture());
    shadow.anchor.set(0.5);
    shadow.width = shadow.height = baseRadius * 2.7;
    shadow.y = 5;
    shadow.alpha = 0.5;
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
        fontFamily: TREE_FONT,
        fontSize: r * 0.62,
        fontWeight: '600',
        letterSpacing: 0.5,
        fill: 0xffffff,
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
    // No ring for the living — clean circles floating on white; depth comes
    // from the soft shadow. Only meaningful states get a rim.
    if (this.deceased) {
      ring.circle(0, 0, r).stroke({ width: 2.5, color: hex('#6b5e7a'), alpha: 0.85 });
    }
    if (this.person.confidence === 'uncertain') {
      drawDashedCircle(ring, r + 4, 16, { width: 1.2, color: hex('#a6abb3'), alpha: 0.6 });
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

  // Called every frame with the bubble's target state and the frame dt. Scale
  // springs (cool pop-in on reveal); alpha eases.
  setVisualState({ scale, alpha, lift, blur }, dt = 1 / 60) {
    this.scaleSpring.setTarget(scale);
    const s = this.scaleSpring.step(dt);
    this.curAlpha += (alpha - this.curAlpha) * Math.min(1, dt * 7);
    this.root.visible = this.curAlpha > 0.012;
    this.root.scale.set(Math.max(0, s));
    this.root.alpha = this.curAlpha;
    this.shadow.alpha = 0.5 * this.curAlpha * (0.7 + 0.3 * lift);
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
