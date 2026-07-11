import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  Assets,
  ColorMatrixFilter,
  BlurFilter,
  Circle,
} from 'pixi.js';
import { monogramColors, initials, hex } from '../lib/color.js';
import { softShadowTexture } from './textures.js';
import { Spring } from '../lib/spring.js';

const TREE_FONT = 'Hanken Grotesk, system-ui, sans-serif';

// Prefer the real family_name field; fall back to the last token of the
// display name (the same rule store.js uses when it assigns a new
// relative's family_name from an anchor person — see addRelative()).
function surnameOf(person) {
  if (person.family_name) return person.family_name.trim();
  const parts = (person.display_name || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

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
    // Deterministic per-person phase/period so the "breathing" scale pulse
    // BubbleTree applies to living bubbles desyncs across the tree instead
    // of every alive bubble pulsing in lockstep (a cheap string hash — no
    // need for anything stronger than a spread-out phase offset).
    let h = 0;
    for (let i = 0; i < person.id.length; i++) h = (h * 31 + person.id.charCodeAt(i)) >>> 0;
    this._breathPhase = ((h % 1000) / 1000) * Math.PI * 2;
    this._breathPeriod = 3.6 + (h % 7) * 0.35; // ~3.6s – 5.85s, varies per person
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

    // Active-selection accent ring — terracotta stroke, shown only when this bubble is the focused person.
    const activeRing = new Graphics();
    activeRing.eventMode = 'none';
    root.addChild(activeRing);
    this.activeRing = activeRing;
    this._isActive = false;

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
    const isPrivate = this.visibility === 'private';
    const firstName = isPrivate ? 'Private' : person.display_name.trim().split(/\s+/)[0];
    // Same "prefer the real field, fall back to the last token of the
    // display name" rule store.js already uses when it assigns a new
    // relative's family_name — so the label agrees with the data even for
    // the many people who only ever had a single "First Last" name field
    // typed into Edit, never a separate surname field.
    const lastName = isPrivate ? '' : surnameOf(person);
    const showLast = !!lastName && lastName !== firstName;

    const firstStyle = {
      fontFamily: TREE_FONT,
      fontSize: 13,
      fontWeight: '700',
      fill: '#241f1c',
      letterSpacing: 0.3,
    };
    const lastStyle = {
      fontFamily: TREE_FONT,
      fontSize: 11,
      fontWeight: '500',
      fill: '#a4988b',
      letterSpacing: 0.2,
    };

    const firstText = new Text({ text: firstName, style: firstStyle });
    firstText.resolution = 2.5;
    firstText.anchor.set(0, 0.5);

    let lastText = null;
    const GAP = 5;
    let contentW = firstText.width;
    if (showLast) {
      lastText = new Text({ text: lastName, style: lastStyle });
      lastText.resolution = 2.5;
      lastText.anchor.set(0, 0.5);
      contentW += GAP + lastText.width;
    }

    const pillW = Math.max(40, contentW + 20);
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

    const startX = -contentW / 2;
    firstText.position.set(startX, 0);

    const group = new Container();
    group.addChild(bg);
    group.addChild(firstText);
    if (lastText) {
      lastText.position.set(startX + firstText.width + GAP, 0);
      group.addChild(lastText);
    }
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

  setActive(isActive) {
    if (isActive === this._isActive) return;
    this._isActive = isActive;
    this.activeRing.clear();
    if (isActive) {
      const r = this.r;
      this.activeRing
        .circle(0, 0, r + 3.5)
        .stroke({ width: 2.5, color: hex('#c2603a'), alpha: 0.9 });
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
    if (this._relLabel) this._relLabel.alpha = this._labelAlpha;
  }

  // Focus-mode relationship caption — a small terracotta pill below the name
  // ("Father", "Niece", …). Cheap: only rebuilt when the text changes. Its
  // alpha tracks the name label (driven in setVisualState) so it fades with
  // the bubble. Pass null/'' to hide.
  setRelationLabel(text) {
    if (text === this._relText) return;
    this._relText = text;
    if (this._relLabel) { this._relLabel.destroy(); this._relLabel = null; }
    if (!text) return;
    const r = this.r;
    // Quiet, secondary treatment: terracotta text on a soft white pill (like the
    // "née" line in the profile) so it reads as a caption, not a loud badge.
    const pillH = 16;
    const pillW = Math.max(28, text.length * 5.8 + 14);
    const rad = pillH / 2;

    const bg = new Graphics();
    bg.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, rad)
      .fill({ color: 0xffffff, alpha: 0.82 });

    const label = new Text({
      text,
      style: {
        fontFamily: TREE_FONT,
        fontSize: 10.5,
        fontWeight: '600',
        fill: '#c2603a',
        letterSpacing: 0.2,
      },
    });
    label.anchor.set(0.5);
    label.resolution = 2.5;

    const group = new Container();
    group.addChild(bg);
    group.addChild(label);
    group.position.set(0, r + 37);
    group.eventMode = 'none';
    group.alpha = this._labelAlpha;
    this.root.addChild(group);
    this._relLabel = group;
  }

  // Birth entrance — driven by BirthEffect during the time-view celebration.
  // `entranceScale` is the 0 → overshoot → 1 multiplier; the final on-screen
  // scale is the bubble's normal target × this. We also keep the scaleSpring
  // and curAlpha in sync with what we set so that, when normal control resumes
  // after the pop settles, there is no visible jump. Label stays hidden — it
  // rises in on its own a beat later via the usual labelAlpha easing.
  applyBirthEntrance(targetScale, entranceScale, entranceAlpha) {
    const s = Math.max(0, targetScale * entranceScale);
    this.scaleSpring.value = s;
    this.scaleSpring.target = targetScale;
    this.scaleSpring.velocity = 0;
    this.curAlpha = entranceAlpha;
    this.root.visible = this.curAlpha > 0.012;
    this.root.scale.set(s);
    this.root.alpha = this.curAlpha;
    this.shadow.alpha = 0.5 * this.curAlpha;
    this.setBlur(0);
    this._labelAlpha += (0 - this._labelAlpha) * 0.2;
    if (this.nameLabel) this.nameLabel.alpha = this._labelAlpha;
    if (this._relLabel) this._relLabel.alpha = this._labelAlpha;
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

  // Small status dot in the top-right corner — chart mode only.
  // Violet filled = deceased; gray outlined = uncertain confidence.
  setChartBadge(show) {
    if (show === this._chartBadgeOn) return;
    this._chartBadgeOn = show;
    if (!this._chartBadge) {
      this._chartBadge = new Graphics();
      this._chartBadge.eventMode = 'none';
      this.root.addChild(this._chartBadge);
    }
    this._chartBadge.clear();
    if (show && (this.deceased || this.person.confidence === 'uncertain')) {
      const r = this.r;
      const bx = r * 0.65, by = -r * 0.65;
      const br = r * 0.16;
      if (this.deceased) {
        this._chartBadge.circle(bx, by, br + 1.5).fill({ color: 0xfaf8f5, alpha: 0.9 });
        this._chartBadge.circle(bx, by, br).fill({ color: 0x6b5e7a, alpha: 0.9 });
      } else {
        this._chartBadge.circle(bx, by, br + 1.5).fill({ color: 0xfaf8f5, alpha: 0.9 });
        this._chartBadge.circle(bx, by, br).stroke({ width: 1.5, color: 0xa6abb3, alpha: 0.75 });
      }
    }
  }

  // Small "−" pip at the bottom-right of the ring: signals that tapping this
  // expanded non-active bubble will collapse its branch.
  setCollapsePip(show) {
    if (show === this._collapsePipOn) return;
    this._collapsePipOn = show;
    if (!this._collapsePip) {
      this._collapsePip = new Graphics();
      // The pip is its own tap target — only it collapses the branch, so a tap
      // on the bubble body just selects. Flag + generous hit area for easy tapping.
      this._collapsePip.__isCollapsePip = true;
      this.root.addChild(this._collapsePip);
    }
    this._collapsePip.clear();
    const r = this.r;
    const bx = r * 0.65, by = r * 0.65;
    const br = r * 0.22;
    if (show) {
      this._collapsePip.eventMode = 'static';
      this._collapsePip.cursor = 'pointer';
      this._collapsePip.hitArea = new Circle(bx, by, br + 7);
      // White background disc with soft border
      this._collapsePip
        .circle(bx, by, br + 1.5).fill({ color: 0xfaf8f5, alpha: 0.96 })
        .circle(bx, by, br + 1.5).stroke({ width: 1, color: 0xddd8d2, alpha: 0.9 });
      // Minus bar
      const hw = br * 0.55;
      this._collapsePip
        .roundRect(bx - hw, by - 1.2, hw * 2, 2.4, 1.2)
        .fill({ color: 0x8a8480, alpha: 0.85 });
    } else {
      this._collapsePip.eventMode = 'none';
      this._collapsePip.hitArea = null;
    }
  }

  // Warm gold ring left behind after the "what's changed" recap tour visits
  // this bubble — stays lit for the rest of the tour (and a little after) so
  // by the time it ends you can see the whole constellation of who changed,
  // at a glance, without re-reading the queue list.
  setRecapGlow(on) {
    if (on === this._recapGlow) return;
    this._recapGlow = on;
    if (!this._recapRing) {
      this._recapRing = new Graphics();
      this._recapRing.eventMode = 'none';
      this.root.addChild(this._recapRing);
    }
    this._recapRing.clear();
    if (on) {
      this._recapRing.circle(0, 0, this.r + 5.5).stroke({ width: 2.2, color: hex('#e8a53d'), alpha: 0.85 });
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
