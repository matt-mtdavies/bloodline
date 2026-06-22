import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
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
    this.visibility = person.visibility || 'full'; // 'full' | 'summary' | 'private'
    // Eased display state. Scale springs (with a little overshoot) so bubbles
    // pop in when revealed; alpha eases so they fade cleanly.
    this.scaleSpring = new Spring(0, { stiffness: 150, damping: 14 });
    this.curAlpha = 0;
    this._labelAlpha = 0;

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

    // Privacy treatments applied on top of the base portrait.
    if (this.visibility === 'private') {
      this._applyPrivateOverlay(baseRadius);
    } else if (this.visibility === 'summary') {
      this._applySummaryBadge(baseRadius);
    }

    this._buildNameLabel(person, baseRadius);
    // Private people never load a photo — the sealed look must hold.
    if (this.visibility !== 'private') this.tryLoadPhoto();
  }

  // Sealed overlay for private people: semi-opaque white film + lock icon.
  _applyPrivateOverlay(r) {
    // Desaturate and dim the portrait.
    const cm = new ColorMatrixFilter();
    cm.saturate(-1, false);
    cm.brightness(1.18, true);
    this.portrait.filters = [cm];

    // Frosted cap over the bubble.
    const cap = new Graphics();
    cap.circle(0, 0, r).fill({ color: 0xfaf8f5, alpha: 0.58 });
    this.root.addChild(cap);

    // Lock icon drawn with Graphics so no asset load is needed.
    const lk = new Graphics();
    const lw = r * 0.28, lh = r * 0.22, lx = -lw / 2, ly = r * 0.05;
    const arc = r * 0.13;
    lk.roundRect(lx, ly, lw, lh, arc).fill({ color: 0x241f1c, alpha: 0.55 });
    // Shackle (top arc of lock)
    lk.moveTo(lx + lw * 0.28, ly)
      .arcTo(lx + lw * 0.28, ly - r * 0.19, lx + lw / 2, ly - r * 0.19, r * 0.1)
      .arcTo(lx + lw * 0.72, ly - r * 0.19, lx + lw * 0.72, ly, r * 0.1)
      .lineTo(lx + lw * 0.72, ly)
      .stroke({ width: r * 0.05, color: 0x241f1c, alpha: 0.55, cap: 'round' });
    lk.y = -r * 0.1;
    this.root.addChild(lk);
    this._lockIcon = lk;
  }

  // Small shield badge in the lower-right for summary (protected) people.
  _applySummaryBadge(r) {
    const badge = new Graphics();
    const bx = r * 0.58, by = r * 0.58;
    badge.circle(bx, by, r * 0.26).fill({ color: 0xfaf8f5, alpha: 0.95 });
    badge.circle(bx, by, r * 0.26).stroke({ width: 1.2, color: 0xddd8d2, alpha: 0.9 });
    // Mini shield path
    const sw = r * 0.22, sh = r * 0.25;
    badge.moveTo(bx, by - sh / 2)
      .lineTo(bx - sw / 2, by - sh * 0.25)
      .lineTo(bx - sw / 2, by + sh * 0.1)
      .quadraticCurveTo(bx - sw / 2, by + sh / 2, bx, by + sh / 2)
      .quadraticCurveTo(bx + sw / 2, by + sh / 2, bx + sw / 2, by + sh * 0.1)
      .lineTo(bx + sw / 2, by - sh * 0.25)
      .closePath()
      .fill({ color: 0x8a8480, alpha: 0.7 });
    this.root.addChild(badge);
    this._summaryBadge = badge;
  }

  _buildNameLabel(person, baseRadius) {
    const firstName = this.visibility === 'private'
      ? 'Private'
      : person.display_name.trim().split(/\s+/)[0];
    // Estimate pill width: ~6.6 px per char at 11px/700 + horizontal padding
    const pillW = Math.max(36, firstName.length * 6.6 + 20);
    const pillH = 20;
    const r = pillH / 2;

    const bg = new Graphics();
    // Micro-shadow layer (offset 1.5 px down, very faint)
    bg.roundRect(-pillW / 2 + 0.5, -pillH / 2 + 2, pillW, pillH, r)
      .fill({ color: 0x000000, alpha: 0.07 });
    // White pill
    bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, r)
      .fill({ color: 0xffffff, alpha: 0.97 });
    // Hairline border
    bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, r)
      .stroke({ width: 0.8, color: 0xddd8d2, alpha: 0.8 });

    const label = new Text({
      text: firstName,
      style: {
        fontFamily: TREE_FONT,
        fontSize: 11,
        fontWeight: '700',
        fill: '#241f1c',
        letterSpacing: 0.3,
      },
    });
    label.anchor.set(0.5, 0.5);
    label.resolution = 2.5;

    const group = new Container();
    group.addChild(bg);
    group.addChild(label);
    // Position below the ring, with a small gap
    group.position.set(0, baseRadius + 16);
    group.alpha = 0;
    // Labels are not interactive — clicks should pass through to the bubble
    group.eventMode = 'none';
    this.root.addChild(group);
    this.nameLabel = group;
  }

  drawMonogram() {
    const { base } = monogramColors(this.person.display_name);
    const r = this.r;
    const g = new Graphics();
    // Flat, single solid colour — clean and modern.
    g.circle(0, 0, r).fill(hex(base));

    // A refined "shadow person": a properly proportioned head and a smooth
    // shoulder line drawn with bezier curves (not a circle + blob). Clipped by
    // the bubble mask into a clean placeholder portrait.
    const W = 0xffffff;
    const A = 0.95;
    g.circle(0, -r * 0.3, r * 0.235).fill({ color: W, alpha: A }); // head
    g.moveTo(-r * 0.62, r * 1.1)
      .lineTo(-r * 0.62, r * 0.64)
      .bezierCurveTo(-r * 0.62, r * 0.18, -r * 0.34, r * 0.05, 0, r * 0.05)
      .bezierCurveTo(r * 0.34, r * 0.05, r * 0.62, r * 0.18, r * 0.62, r * 0.64)
      .lineTo(r * 0.62, r * 1.1)
      .closePath()
      .fill({ color: W, alpha: A }); // shoulders
    this.portrait.addChild(g);
    this._mono = g;

    // Small initials tucked at the bottom edge so the person stays identifiable.
    const text = new Text({
      text: initials(this.person.display_name),
      style: {
        fontFamily: TREE_FONT,
        fontSize: r * 0.26,
        fontWeight: '700',
        letterSpacing: 0.5,
        fill: hex(base),
      },
    });
    text.anchor.set(0.5);
    text.position.set(0, r * 0.42);
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
      let tex;
      if (this.person.photo.startsWith('data:')) {
        const img = new Image();
        img.src = this.person.photo;
        await img.decode();
        if (this._destroyed) return;
        tex = Texture.from(img);
      } else {
        tex = await Assets.load(this.person.photo);
      }
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
  setVisualState({ scale, alpha, lift, blur, labelAlpha = 0 }, dt = 1 / 60) {
    this.scaleSpring.setTarget(scale);
    const s = this.scaleSpring.step(dt);
    this.curAlpha += (alpha - this.curAlpha) * Math.min(1, dt * 7);
    this.root.visible = this.curAlpha > 0.012;
    this.root.scale.set(Math.max(0, s));
    this.root.alpha = this.curAlpha;
    this.shadow.alpha = 0.5 * this.curAlpha * (0.7 + 0.3 * lift);
    this.setBlur(blur);
    // Name label — eases independently so it can linger a beat after the bubble fades
    this._labelAlpha += (labelAlpha - this._labelAlpha) * Math.min(1, dt * 4.5);
    if (this.nameLabel) this.nameLabel.alpha = this._labelAlpha;
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

  // Show/hide tiny chevron indicators above/below a bubble to signal that it
  // has parents or children not yet revealed in the tree. Only redraws when the
  // state changes — safe to call every frame.
  setDepthHint(hasParents, hasChildren) {
    if (hasParents === this._hintParents && hasChildren === this._hintChildren) return;
    this._hintParents = hasParents;
    this._hintChildren = hasChildren;

    if (!this._depthHint) {
      this._depthHint = new Graphics();
      this._depthHint.eventMode = 'none';
      this.root.addChild(this._depthHint);
    }
    this._depthHint.clear();
    const r = this.r;
    const color = hex('#a6abb3');
    const alpha = 0.75;
    const dotR = 2.8;
    const gap = 6;

    if (hasParents) {
      // Three dots above the bubble — "more ancestors above"
      for (let i = -1; i <= 1; i++) {
        this._depthHint.circle(i * gap, -(r + 14), dotR).fill({ color, alpha });
      }
    }
    if (hasChildren) {
      // Three dots below the name label — "more descendants below"
      for (let i = -1; i <= 1; i++) {
        this._depthHint.circle(i * gap, r + 42, dotR).fill({ color, alpha });
      }
    }
  }

  // Warm dashed accent ring for people who've been sent an invite.
  setInvited(invited) {
    if (invited === this._invited) return;
    this._invited = invited;
    if (!this._inviteRing) {
      this._inviteRing = new Graphics();
      this._inviteRing.eventMode = 'none';
      this.root.addChild(this._inviteRing);
    }
    this._inviteRing.clear();
    if (invited) {
      drawDashedCircle(this._inviteRing, this.r + 7, 14, {
        width: 1.8,
        color: hex('#c2603a'),
        alpha: 0.55,
      });
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
