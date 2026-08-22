/*
 * Canopy — drawing.
 *
 * The visual language, and nothing else: this module knows how to draw a
 * planned frame at a given moment in its growth. It owns no layout decisions
 * and no timing decisions — those belong to plan.js and growth.js.
 *
 * Palette is deliberately shared with the rest of the app (see links.js):
 * a current union is a warm peach capsule with a terracotta border, a former
 * union is muted greige and dashed, a widowed union is lavender. Canopy is a
 * new view, not a new product, and a couple should look like a couple
 * wherever you meet them.
 */

import { Container, Graphics, Sprite, Texture, Assets, Text, TextStyle } from 'pixi.js';
import { unitAnchor } from './plan.js';
import { progressAt, easeBranch, easeBud, bondKey } from './growth.js';

const INK = 0x2b2622;
const INK_SOFT = 0x6b6259;
const PAPER = 0xfdfbf7;
const TERRA = 0xc2603a;
const GOLD = 0xc4913f;

const POD = {
  current: { fill: 0xf6e6dc, border: 0xc2603a },
  former: { fill: 0xe8e3de, border: 0xa89280 },
  widowed: { fill: 0xece7f2, border: 0x7a6a9e },
};

/* Band presentation. Size, saturation and opacity fall off together with
 * kinship distance, so one gradient does three jobs and reads as depth
 * rather than as three unrelated effects. */
const BAND_ALPHA = { hearth: 1, kin: 0.94, reach: 0.76 };
/* Reach DOES carry a name. The first build omitted it on the theory that a
 * name could not be set legibly at that size — then the render showed four
 * grandparents reduced to unidentifiable monograms, which is a worse failure
 * than small type. At 0.66 scale the disc is still ~36px, and a 13px serif
 * name under it reads cleanly. Design decisions about legibility have to be
 * made against the actual pixels, not predicted. */
const BAND_LABEL_ALPHA = { hearth: 1, kin: 0.92, reach: 0.78 };
const BAND_LABEL_SIZE = { hearth: 17, kin: 15, reach: 13 };
const BAND_RING = { hearth: 2.6, kin: 2.1, reach: 1.6 };

/* Ribbon widths — a descent line is wide at the union and narrows to the
 * child, so lineage visibly FLOWS DOWNWARD instead of reading as a wire
 * strung between two dots. */
const W_UNION = 5.6;
const W_JUNCTION = 3.2;
const W_CHILD = 1.7;

/* ── geometry helpers ─────────────────────────────────────────────────── */

/* How far below a node its name block extends — a name, plus a lifespan on
 * a hearth node. Descents and horizon marks both have to clear it. */
export function labelDrop(band) {
  return band === 'hearth' ? 52 : band === 'kin' ? 34 : 30;
}

/** The polyline a descent takes: union → stem → junction bar → child. */
function descentPath(from, to, level = 0) {
  // Each parent unit gets its own junction height (see plan.js) so two
  // sibling groups sharing a row cannot merge their bars into one line.
  const junctionY = from.y + (to.y - from.y) * (0.56 + level * 0.07);
  // Leave from under the capsule for a pod, but from under the NAME for a
  // lone parent — otherwise the stem is drawn straight through their label.
  const startY = from.isPod
    ? from.y + from.r * 0.86
    : from.y + from.r + labelDrop(from.band);
  return [
    { x: from.x, y: startY, w: W_UNION },
    { x: from.x, y: junctionY, w: W_JUNCTION },
    { x: to.x, y: junctionY, w: W_JUNCTION },
    { x: to.x, y: to.y - to.r * 0.9, w: W_CHILD },
  ];
}

/** Truncate a polyline to the first `u` of its own arc length. */
function growPolyline(pts, u) {
  if (u >= 1) return pts;
  if (u <= 0) return [];
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(d); total += d;
  }
  if (total === 0) return pts;
  let want = total * u;
  const out = [pts[0]];
  for (let i = 0; i < segs.length; i++) {
    if (want >= segs[i]) { out.push(pts[i + 1]); want -= segs[i]; continue; }
    const f = segs[i] === 0 ? 0 : want / segs[i];
    const a = pts[i], b = pts[i + 1];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f });
    break;
  }
  return out;
}

/** Draw a polyline as a filled, tapered ribbon — one shape, one draw call. */
function taperedRibbon(g, pts, color, alpha) {
  if (pts.length < 2) return;
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const hw = (pts[i].w ?? W_CHILD) / 2;
    left.push({ x: pts[i].x - dy * hw, y: pts[i].y + dx * hw });
    right.push({ x: pts[i].x + dy * hw, y: pts[i].y - dx * hw });
  }
  g.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) g.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i].x, right[i].y);
  g.closePath();
  g.fill({ color, alpha });
}

/** A capsule wrapping a pod's two end circles. */
function capsulePath(g, a, b, hw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * hw, ny = dx / len * hw;
  const ang = Math.atan2(dy, dx);
  g.moveTo(a.x + nx, a.y + ny);
  g.lineTo(b.x + nx, b.y + ny);
  g.arc(b.x, b.y, hw, ang + Math.PI / 2, ang - Math.PI / 2, true);
  g.lineTo(a.x - nx, a.y - ny);
  g.arc(a.x, a.y, hw, ang - Math.PI / 2, ang + Math.PI / 2, true);
  g.closePath();
  return g;
}

function dashedCapsule(g, a, b, hw, color, alpha) {
  // A dissolved bond should look dissolved: the outline is broken rather
  // than merely a different colour, so it reads at a glance and without
  // relying on colour alone.
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * hw, ny = dx / len * hw;
  const dash = 9, gap = 7;
  for (const s of [1, -1]) {
    let t = 0;
    while (t < len) {
      const t2 = Math.min(len, t + dash);
      g.moveTo(a.x + (dx * t) / len + nx * s, a.y + (dy * t) / len + ny * s);
      g.lineTo(a.x + (dx * t2) / len + nx * s, a.y + (dy * t2) / len + ny * s);
      t = t2 + gap;
    }
  }
  g.stroke({ color, width: 2, alpha, cap: 'round' });
  const ang = Math.atan2(dy, dx);
  for (const [c, from] of [[a, ang + Math.PI / 2], [b, ang - Math.PI / 2]]) {
    g.arc(c.x, c.y, hw, from, from + Math.PI, c === a);
    g.stroke({ color, width: 2, alpha, cap: 'round' });
  }
}

/* ── Bonds ────────────────────────────────────────────────────────────── */

export function drawBonds(g, frame, schedule, t) {
  g.clear();

  // Unions first, furthest back — the capsule sits behind its members.
  frame.bonds.forEach((b, i) => {
    if (b.kind !== 'union') return;
    const a = frame.nodes.get(b.a), c = frame.nodes.get(b.b);
    if (!a || !c) return;
    const u = progressAt(schedule.bonds.get(bondKey(b, i)), t);
    if (u <= 0) return;
    const e = schedule.reduced ? u : easeBranch(u);
    const pal = POD[b.status] || POD.current;
    const hw = Math.max(a.r, c.r) * 1.12;
    // The capsule grows from the anchored member outward to the partner, so
    // the union appears to reach for them rather than blink into being.
    const to = { x: a.x + (c.x - a.x) * e, y: a.y + (c.y - a.y) * e };
    if (b.status === 'former') {
      /* A dissolved union is a broken THREAD between two people, not a
       * capsule around them. A capsule says "these two are one unit", which
       * is precisely what a former partnership is not — and because a former
       * partner is placed outboard rather than inside the pod, a capsule
       * also had to stretch far enough to swallow whoever sat between. Drawn
       * edge to edge so it reads as a link, and dashed so it reads as
       * dissolved without relying on colour alone. */
      const dx = c.x - a.x, dy = c.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const start = { x: a.x + ux * (a.r + 3), y: a.y + uy * (a.r + 3) };
      const endFull = { x: c.x - ux * (c.r + 3), y: c.y - uy * (c.r + 3) };
      const end = { x: start.x + (endFull.x - start.x) * e, y: start.y + (endFull.y - start.y) * e };
      drawDashedPath(g, [start, end], pal.border, 0.75);
    } else {
      capsulePath(g, a, to, hw).fill({ color: pal.fill, alpha: 0.55 * e });
      capsulePath(g, a, to, hw).stroke({ color: pal.border, width: 2.4, alpha: 0.8 * e, cap: 'round' });
    }
  });

  // Descents on top of the capsules but under the people.
  frame.bonds.forEach((b, i) => {
    if (b.kind !== 'descent') return;
    const from = unitAnchor(frame, b.parentUnit);
    const to = frame.nodes.get(b.child);
    if (!from || !to) return;
    const u = progressAt(schedule.bonds.get(bondKey(b, i)), t);
    if (u <= 0) return;
    const e = schedule.reduced ? 1 : easeBranch(u);
    const full = descentPath(from, to, b.junctionLevel || 0);
    const pts = schedule.reduced ? full : growPolyline(full, e);
    const alpha = (schedule.reduced ? u : 1) * (BAND_ALPHA[to.band] ?? 1) * 0.85;
    if (b.qualifier === 'step' || b.qualifier === 'adoptive' || b.qualifier === 'adopted') {
      // A step or adoptive descent is dashed, matching the app's existing
      // convention — the bond is real, and it is also not biological.
      drawDashedPath(g, pts, INK_SOFT, alpha * 0.85);
    } else {
      taperedRibbon(g, pts, INK_SOFT, alpha);
    }
  });
}

function drawDashedPath(g, pts, color, alpha) {
  if (pts.length < 2) return;
  const dash = 10, gap = 7;
  let carry = 0, on = true;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t < len) {
      const seg = Math.min(len - t, (on ? dash : gap) - carry);
      if (on) {
        g.moveTo(a.x + ((b.x - a.x) * t) / len, a.y + ((b.y - a.y) * t) / len);
        g.lineTo(a.x + ((b.x - a.x) * (t + seg)) / len, a.y + ((b.y - a.y) * (t + seg)) / len);
      }
      t += seg;
      carry += seg;
      if (carry >= (on ? dash : gap)) { on = !on; carry = 0; }
    }
  }
  g.stroke({ color, width: 2, alpha, cap: 'round' });
}

/* ── Horizon marks ────────────────────────────────────────────────────────
 * Past the Reach band a branch does not simply stop — it terminates in a
 * mark carrying a real count, so the frame states what it is NOT showing
 * rather than quietly implying the family ends here.
 */
/* How far past a unit a horizon mark sits. Downward marks have to clear the
 * name (and, on a hearth node, the lifespan line beneath it) — the first
 * build used one constant for both directions and dropped "+1" straight on
 * top of a sibling's name. */
export function horizonOffset(r, dir, band = 'kin') {
  return dir < 0 ? r + 34 : r + labelDrop(band) + 30;
}

export function drawHorizons(g, frame, schedule, t, labelLayer) {
  g.clear();
  const u = progressAt({ delay: schedule.horizonDelay ?? 0, dur: schedule.horizonDur ?? 160 }, t);
  if (u <= 0) { labelLayer.visible = false; return; }
  labelLayer.visible = true;
  labelLayer.alpha = u;
  for (const h of frame.horizons) {
    const anchor = unitAnchor(frame, h.unitId);
    if (!anchor) continue;
    const dir = h.dir === 'up' ? -1 : 1;
    const y = anchor.y + dir * horizonOffset(anchor.r, dir, anchor.band);
    g.moveTo(anchor.x, anchor.y + dir * anchor.r * 0.9);
    g.lineTo(anchor.x, y - dir * 11);
    g.stroke({ color: GOLD, width: 1.6, alpha: 0.5 * u });
    g.roundRect(anchor.x - 26, y - 11, 52, 22, 11);
    g.fill({ color: PAPER, alpha: 0.9 * u });
    g.roundRect(anchor.x - 26, y - 11, 52, 22, 11);
    g.stroke({ color: GOLD, width: 1.4, alpha: 0.85 * u });
  }
}

/* ── People ───────────────────────────────────────────────────────────── */

const labelStyle = (size, weight, color) => new TextStyle({
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: size,
  fontWeight: weight,
  fill: color,
  align: 'center',
});

export class CanopyNode {
  constructor(person, node) {
    this.person = person;
    this.id = person.id;
    this.root = new Container();
    this.root.__canopyId = person.id;
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this._ownedTexture = null;
    this._destroyed = false;

    const r = node.r;
    this.baseR = r;
    // Remembered so the view can tell a node that merely MOVED between
    // frames from one whose fidelity changed and has to be rebuilt at a new
    // size — see CanopyTree's rebuildNodes.
    this.band = node.band;
    this.isFocus = node.isFocus;

    // Portrait: a monogram immediately, the photo when (and if) it loads —
    // a face never blocks the frame from being drawn.
    this.portrait = new Container();
    const disc = new Graphics();
    disc.circle(0, 0, r).fill({ color: tintFor(person) });
    this.portrait.addChild(disc);

    const initials = monogram(person);
    if (initials) {
      const mono = new Text({ text: initials, style: labelStyle(r * 0.72, 600, 0xffffff) });
      mono.anchor.set(0.5);
      mono.alpha = 0.92;
      this.portrait.addChild(mono);
      this.mono = mono;
    }

    const mask = new Graphics();
    mask.circle(0, 0, r).fill({ color: 0xffffff });
    this.portrait.addChild(mask);
    this.portrait.mask = mask;
    this.root.addChild(this.portrait);

    // Ring — the focus person wears terracotta; everyone else a quiet ink.
    this.ring = new Graphics();
    this.root.addChild(this.ring);
    this.drawRing(node);

    // Name. Reach-band people deliberately carry NO name: at that size a
    // name cannot be set legibly, so it is omitted as a design decision
    // rather than shipped as unreadable three-pixel type.
    if (BAND_LABEL_ALPHA[node.band] > 0) {
      const name = new Text({
        text: shortName(person),
        style: labelStyle(BAND_LABEL_SIZE[node.band] ?? 15, 600, INK),
      });
      name.anchor.set(0.5, 0);
      name.position.set(0, r + 11);
      name.alpha = BAND_LABEL_ALPHA[node.band];
      this.root.addChild(name);
      this.name = name;

      const sub = lifespan(person);
      if (sub && node.band === 'hearth') {
        const st = new Text({ text: sub, style: labelStyle(13, 400, INK_SOFT) });
        st.anchor.set(0.5, 0);
        st.position.set(0, r + 32);
        st.alpha = 0.85;
        this.root.addChild(st);
        this.sub = st;
      }
    }

    this.loadPhoto(r);
  }

  drawRing(node) {
    const g = this.ring;
    g.clear();
    const w = BAND_RING[node.band] ?? 2;
    if (node.isFocus) {
      // A faint warm lift so every frame has somewhere for the eye to land.
      g.circle(0, 0, node.r + 9).stroke({ color: TERRA, width: 1.2, alpha: 0.28 });
      g.circle(0, 0, node.r + 1).stroke({ color: TERRA, width: w + 0.8, alpha: 0.95 });
    } else {
      g.circle(0, 0, node.r + 1).stroke({ color: INK, width: w, alpha: 0.16 });
    }
    if (this.person.is_deceased) {
      g.circle(0, 0, node.r + 5).stroke({ color: INK_SOFT, width: 1, alpha: 0.3 });
    }
  }

  async loadPhoto(r) {
    const src = this.person.photo;
    if (!src) return;
    try {
      let tex;
      if (src.startsWith('data:')) {
        const img = new Image();
        img.src = src;
        await img.decode();
        tex = Texture.from(img);
        // A data:-URL texture is minted fresh here rather than shared through
        // Pixi's cache, so this node owns it and must free it on destroy.
        this._ownedTexture = tex;
      } else {
        tex = await Assets.load(src);
      }
      if (this._destroyed) { this._ownedTexture?.destroy(true); return; }
      const sprite = new Sprite(tex);
      const size = r * 2;
      const scale = Math.max(size / tex.width, size / tex.height);
      sprite.scale.set(scale);
      sprite.anchor.set(0.5);
      sprite.alpha = 0;
      this.portrait.addChildAt(sprite, 1);
      this.photoSprite = sprite;
      if (this.mono) this.monoFading = true;
    } catch {
      /* A missing or blocked photo is not an error worth surfacing — the
       * monogram is a complete, designed state, not a fallback. */
    }
  }

  /** @param {number} open 0..1 bud progress */
  apply(node, open, ambient, tSeconds) {
    this.root.position.set(node.x + ambient.x, node.y + ambient.y);
    const s = node.isFocus ? 1 : open;
    this.root.scale.set(s);
    this.root.alpha = (BAND_ALPHA[node.band] ?? 1) * Math.min(1, open * 1.3);
    // Photos cross-fade in over their monogram once decoded.
    if (this.photoSprite && this.photoSprite.alpha < 1) {
      this.photoSprite.alpha = Math.min(1, this.photoSprite.alpha + 0.06);
      if (this.mono) this.mono.alpha = Math.max(0, 0.92 - this.photoSprite.alpha);
    }
  }

  destroy() {
    this._destroyed = true;
    this.root.destroy({ children: true });
    if (this._ownedTexture) { this._ownedTexture.destroy(true); this._ownedTexture = null; }
  }
}

/* ── content helpers ──────────────────────────────────────────────────── */

function monogram(p) {
  const n = (p.display_name || '').trim();
  if (!n) return '';
  const parts = n.split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function shortName(p) {
  const n = (p.display_name || 'Unknown').trim();
  const parts = n.split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : n;
}

function lifespan(p) {
  const b = (p.birth_date || '').slice(0, 4);
  const d = (p.death_date || '').slice(0, 4);
  if (p.is_deceased) return b || d ? `${b || '?'}–${d || '?'}` : 'In memory';
  return b ? `b. ${b}` : '';
}

/* A stable, warm portrait tint per person — never random, so the same face
 * is the same colour every time you meet them. */
const TINTS = [0x8a6f5c, 0x6f7f68, 0x8c6a72, 0x71708c, 0x9a7f52, 0x5f7a80];
function tintFor(p) {
  let h = 0;
  const s = String(p.id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export { progressAt, easeBud };
