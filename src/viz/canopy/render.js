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
import { softShadowTexture, warmGlowTexture } from '../textures.js';
import { unitAnchor } from './plan.js';
import { progressAt, easeBranch, easeBud, bondKey } from './growth.js';
import { labelDrop } from './geometry.js';

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
/* How firmly each band sits on the paper — see the shadow note in CanopyNode. */
const BAND_SHADOW = { hearth: 0.34, kin: 0.24, reach: 0.13 };

/* Ribbon widths — a descent line is wide at the union and narrows to the
 * child, so lineage visibly FLOWS DOWNWARD instead of reading as a wire
 * strung between two dots. */
const W_UNION = 6.2;
const W_TRUNK = 5.0;
/* Deliberately below W_TRUNK — see descentPath's fork note. */
const W_BRANCH = 3.1;
const W_CHILD = 1.9;
/* Bonds are drawn in a warm bark brown rather than neutral grey. Grey lines
 * against warm paper read as engineering diagram; the warm tone lets them
 * sit in the same world as the portraits and the paper they cross. */
const BRANCH = 0x8a7563;

/* ── geometry helpers ─────────────────────────────────────────────────── */

/* The path a descent takes.
 *
 * The first build routed this orthogonally — stem, horizontal bar, drop —
 * and the render was decisive: right angles read as PLUMBING. Four square
 * corners per child turned a family into a circuit diagram, and no amount of
 * palette work was going to rescue that silhouette. A family tree wants a
 * BOUGH: a short trunk leaving the union, then a branch that sweeps away and
 * settles onto the child.
 *
 * So: a straight trunk down to the fork, then a cubic bezier out to the
 * child, sampled into a polyline with a width that tapers along its length.
 * Sampling (rather than drawing a curve primitive) keeps this compatible
 * with growPolyline and taperedRibbon, so the growth animation and the
 * tapering come along for free.
 */
/* Trunk start, child end, and the fork between them. Shared so descentPath
 * and drawFork can never disagree about where the fork is — they did while
 * each computed it independently, and the swelling drifted off the join. */
function trunkSpan(from, to) {
  return {
    startY: from.y + from.r + labelDrop(from.band) + (from.isPod ? 6 : 0),
    endY: to.y - to.r * 0.94,
  };
}
function forkPoint(from, to, level = 0) {
  const { startY, endY } = trunkSpan(from, to);
  return { x: from.x, y: startY + (endY - startY) * (0.34 + level * 0.07) };
}

function descentPath(from, to, level = 0) {
  /* Where the trunk may begin. It has to clear BOTH the union capsule and
   * the names beneath it — a pod's trunk descends from the couple's midpoint,
   * which is exactly where two centred names meet, so a trunk that started at
   * the capsule's edge was drawn straight through the focus person's own
   * name once that name was set larger. Clearing the whole label block is the
   * only rule that holds for every name length. */
  const startY = from.y + from.r + labelDrop(from.band) + (from.isPod ? 6 : 0);
  const endY = to.y - to.r * 0.94;
  /* The fork is placed along what is ACTUALLY left between the trunk's start
   * and the child — measuring it from the parent's centre instead put the
   * fork above the trunk's own start once the start moved down, which drew
   * the branch backwards. */
  const forkY = forkPoint(from, to, level).y;

  const pts = [{ x: from.x, y: startY, w: W_UNION }];
  // The trunk: a short, honest vertical before anything forks.
  pts.push({ x: from.x, y: forkY, w: W_TRUNK });

  /* A branch leaves the fork NARROWER than the trunk arriving at it. Without
   * that step change, a child sitting directly beneath the union produced a
   * branch collinear with the trunk and identical in weight — the two merged
   * into one long unbroken line and the fork simply did not read. A real
   * bough is thicker than the limbs it splits into, and that difference is
   * what makes a fork legible even when one limb continues straight on. */
  const dy = endY - forkY;
  const c1 = { x: from.x, y: forkY + dy * 0.42 };
  const c2 = { x: to.x, y: endY - dy * 0.45 };
  const STEPS = 16;
  for (let i = 1; i <= STEPS; i++) {
    const s = i / STEPS;
    const m = 1 - s;
    pts.push({
      x: m * m * m * from.x + 3 * m * m * s * c1.x + 3 * m * s * s * c2.x + s * s * s * to.x,
      y: m * m * m * forkY + 3 * m * m * s * c1.y + 3 * m * s * s * c2.y + s * s * s * endY,
      // Taper continuously along the branch — thick where it leaves the
      // fork, finest where it meets the child.
      w: W_BRANCH + (W_CHILD - W_BRANCH) * (s * s * (3 - 2 * s)),
    });
  }
  return pts;
}

/* The fork itself — a small swelling where limbs leave the bough, drawn once
 * per parent unit rather than once per child. Botanically true, and it does
 * real work: it gives the eye a definite point of origin for a sibling group
 * and hides the seam where several branch ribbons overlap. */
function drawFork(g, from, to, level, alpha) {
  const f = forkPoint(from, to, level);
  g.circle(f.x, f.y, W_TRUNK * 0.62).fill({ color: BRANCH, alpha });
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

/* Where a person actually IS this frame: where the plan puts them, plus any
 * elastic deflection (a pull, or a sway from someone else being pulled).
 * Bonds resolve through this rather than reading the plan directly, which is
 * what makes a branch BEND when its person is pulled instead of detaching
 * from them — the difference between a living connected thing and a set of
 * independent counters with lines drawn near them. */
const ZERO = { x: 0, y: 0 };
function livePos(frame, id, offsetOf) {
  const n = frame.nodes.get(id);
  if (!n) return null;
  const o = offsetOf ? (offsetOf(id) || ZERO) : ZERO;
  return { ...n, x: n.x + o.x, y: n.y + o.y };
}
/* A union's anchor, following its members' live positions. */
function liveAnchor(frame, unitId, offsetOf) {
  const u = frame.units.find((x) => x.id === unitId);
  if (!u) return null;
  let sx = 0, sy = 0, n = 0;
  let lo = Infinity, hi = -Infinity;
  const anchorIds = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
  for (const m of anchorIds) {
    const p = livePos(frame, m, offsetOf);
    if (!p) continue;
    sx += p.x; sy += p.y; n++;
    lo = Math.min(lo, p.x); hi = Math.max(hi, p.x);
  }
  if (!n) return unitAnchor(frame, unitId);
  const first = anchorIds.map((id) => frame.nodes.get(id)).find(Boolean);
  if (!first) return unitAnchor(frame, unitId);
  return {
    x: (lo + hi) / 2,
    y: sy / n,
    r: first.r,
    band: first.band,
    isPod: anchorIds.length > 1,
  };
}

export function drawBonds(g, frame, schedule, t, offsetOf) {
  g.clear();

  // Unions first, furthest back — the capsule sits behind its members.
  frame.bonds.forEach((b, i) => {
    if (b.kind !== 'union') return;
    const a = livePos(frame, b.a, offsetOf), c = livePos(frame, b.b, offsetOf);
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
      /* A current union is a warm HOLLOW the couple sits in, not a boxed
       * outline around them. The first version drew a 2.4px terracotta hoop,
       * which at pod size read as a selected row in a table — a hard edge
       * competing with the portraits it was supposed to be supporting.
       * Two soft washes and no stroke at all: the couple reads as held,
       * and the eye goes to the faces. */
      capsulePath(g, a, to, hw + 7).fill({ color: pal.fill, alpha: 0.34 * e });
      capsulePath(g, a, to, hw + 1).fill({ color: pal.fill, alpha: 0.82 * e });
    }
  });

  // Descents on top of the capsules but under the people.
  frame.bonds.forEach((b, i) => {
    if (b.kind !== 'descent') return;
    const from = liveAnchor(frame, b.parentUnit, offsetOf);
    const to = livePos(frame, b.child, offsetOf);
    if (!from || !to) return;
    const u = progressAt(schedule.bonds.get(bondKey(b, i)), t);
    if (u <= 0) return;
    const e = schedule.reduced ? 1 : easeBranch(u);
    const full = descentPath(from, to, b.junctionLevel || 0);
    const pts = schedule.reduced ? full : growPolyline(full, e);
    const alpha = (schedule.reduced ? u : 1) * (BAND_ALPHA[to.band] ?? 1) * 0.85;
    // The swelling where this unit's limbs leave the bough. Drawn per bond
    // but at the unit's own fork point, so repeated draws land identically
    // and several siblings simply reinforce the one shape.
    if (e > 0.06) drawFork(g, from, to, b.junctionLevel || 0, alpha);
    if (b.qualifier === 'step' || b.qualifier === 'adoptive' || b.qualifier === 'adopted') {
      // A step or adoptive descent is dashed, matching the app's existing
      // convention — the bond is real, and it is also not biological.
      drawDashedPath(g, pts, BRANCH, alpha * 0.85);
    } else {
      taperedRibbon(g, pts, BRANCH, alpha);
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

    /* Depth. Every disc casts a soft shadow onto the paper, so people SIT ON
     * the ground rather than floating as flat stickers — the single cheapest
     * thing that separates "diagram" from "object". Reuses the app's own
     * pre-rendered shadow texture (one offscreen canvas, shared by every
     * node) rather than a per-node blur filter. */
    const shadow = new Sprite(softShadowTexture());
    shadow.anchor.set(0.5);
    const shadowScale = (r * 2.42) / shadow.texture.width;
    this._shadowScale = shadowScale;
    shadow.scale.set(shadowScale);
    shadow.position.set(0, r * 0.20);
    /* Atmospheric perspective: a shadow's weight is how close something is
     * to the ground it sits on, so distant kin cast almost none and the
     * frame gains real depth rather than three sizes of the same sticker. */
    shadow.alpha = node.isFocus ? 0.52 : BAND_SHADOW[node.band] ?? 0.28;
    this.root.addChild(shadow);
    this.shadow = shadow;

    /* The focus person carries a warm glow beneath the shadow — the eye
     * should find them before it reads a single name. */
    if (node.isFocus) {
      const glow = new Sprite(warmGlowTexture());
      glow.anchor.set(0.5);
      glow.scale.set((r * 4.6) / glow.texture.width);
      glow.alpha = 0.34;
      this.root.addChildAt(glow, 0);
      this.glow = glow;
    }

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
      /* The focus person's name is set larger than anyone else's. The frame
       * is ABOUT them, and hierarchy in the type is what says so without
       * another ring, badge or colour — the glow tells the eye where to
       * land, the type tells it who it landed on. */
      const name = new Text({
        text: shortName(person),
        style: labelStyle(
          node.isFocus ? 21 : (BAND_LABEL_SIZE[node.band] ?? 15),
          node.isFocus ? 700 : 600,
          INK,
        ),
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
      // The focus reads as focus through the glow and the shadow beneath it;
      // the ring only needs to define the edge crisply. A heavy terracotta
      // hoop (the first attempt) read as a UI selection state stamped onto
      // the portrait rather than as a person being lit.
      g.circle(0, 0, node.r + 1.5).stroke({ color: PAPER, width: w + 2.2, alpha: 0.9 });
      g.circle(0, 0, node.r + 1.5).stroke({ color: TERRA, width: w * 0.72, alpha: 0.85 });
    } else {
      // A pale paper rim lifts every portrait off the ground the way a
      // photographic border does, with the ink hairline just defining the
      // edge. Warm, not grey.
      g.circle(0, 0, node.r + 1.5).stroke({ color: PAPER, width: w + 1.6, alpha: 0.75 });
      g.circle(0, 0, node.r + 1.5).stroke({ color: 0x6f6154, width: w * 0.5, alpha: 0.2 });
    }
    if (this.person.is_deceased) {
      // A quiet second rim, set off from the portrait — remembrance, not a
      // warning badge.
      g.circle(0, 0, node.r + 6.5).stroke({ color: INK_SOFT, width: 1, alpha: 0.26 });
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

  /** Pointer resting on this person — a small lift, so the tree answers
   *  when you point at it. Costs nothing structurally and does a great deal
   *  for whether the thing feels responsive. */
  setHover(on) {
    if (this._hover === on) return;
    this._hover = on;
    this.hoverAmt = this.hoverAmt ?? 0;
  }

  /**
   * @param {object} node    planned position from the frame
   * @param {number} open    0..1 bud progress
   * @param {object} ambient {x, y, scale} breathing offset
   * @param {object} defl    {x, y} elastic deflection (pull / sway)
   */
  apply(node, open, ambient, defl) {
    const d = defl || ZERO;
    this.root.position.set(node.x + ambient.x + d.x, node.y + ambient.y + d.y);

    // Hover eases rather than snapping — a jump on pointer-over reads as a
    // glitch, a rise reads as attention.
    const want = this._hover ? 1 : 0;
    this.hoverAmt = (this.hoverAmt ?? 0) + (want - (this.hoverAmt ?? 0)) * 0.18;

    const s = (node.isFocus ? 1 : open) * (ambient.scale ?? 1) * (1 + this.hoverAmt * 0.045);
    this.root.scale.set(s);
    this.root.alpha = (BAND_ALPHA[node.band] ?? 1) * Math.min(1, open * 1.3);

    /* Being pulled lifts you off the paper: the shadow drops away and grows,
     * exactly as a real object's would. This is most of why the drag reads as
     * physical rather than as a sprite sliding around. */
    if (this.shadow) {
      const lift = Math.min(1, Math.hypot(d.x, d.y) / 60) + this.hoverAmt * 0.5;
      const base = node.isFocus ? 0.52 : (BAND_SHADOW[node.band] ?? 0.28);
      this.shadow.alpha = base * (1 - lift * 0.34);
      this.shadow.scale.set(this._shadowScale * (1 + lift * 0.16));
      this.shadow.position.set(0, node.r * 0.20 + lift * 7);
    }

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
/* Portrait tints.
 *
 * The first set was six saturated hues spread across the wheel — teal,
 * olive, violet, mauve — and against warm paper they read as a chart of
 * unrelated entities rather than as one family. Colour was carrying no
 * meaning and actively fighting the ground.
 *
 * These sit deliberately close together: low saturation, one narrow warm
 * band from taupe through clay to sage-grey, all at similar value so white
 * initials stay legible on every one. Enough separation to tell two
 * neighbouring faces apart, not enough for anyone to read as belonging to a
 * different picture. They are a stand-in for a photograph, and a wall of
 * family photographs has exactly this quality — varied, but tonally one
 * thing. */
const TINTS = [0x9d8570, 0x8b8d76, 0xa8886e, 0x86918b, 0xa38a80, 0x94897d, 0x9c8368, 0x8d8578];
function tintFor(p) {
  let h = 0;
  const s = String(p.id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export { progressAt, easeBud };
