/*
 * Canopy — motion.
 *
 * Critically damped springs, stepped in CLOSED FORM rather than integrated.
 *
 * Critical damping is the fastest approach to a target that never overshoots
 * and never oscillates, and the residual decays as (1 + ωt)·e^(−ωt) — so
 * macro motion provably STOPS. That property is the whole point: the organic
 * tree's aliveness came from a simulation still negotiating with itself, so
 * motion never truly ended and the composition kept sliding. Here the tree
 * settles hard, and whatever life it has is put back deliberately (see the
 * ambient breathing below) rather than left over from unfinished physics.
 *
 * Closed form rather than an explicit integrator means the step is exact at
 * any timestep: a dropped frame moves a value exactly as far as the frames
 * it replaced would have, instead of the overshoot Euler gives you when dt
 * spikes. It also makes any test of this independent of frame pacing.
 */

import { labelDrop } from './render.js';

/** Angular frequency from a "time to visually arrive" in seconds — the knob
 *  is expressed as a duration because nobody can picture a stiffness. */
export function omegaFor(seconds) {
  // For a critically damped system the residual falls under 1% at ωt ≈ 6.64.
  return 6.64 / Math.max(0.001, seconds);
}

/** One exact critically damped step. Returns [value, velocity]. */
export function step1D(value, velocity, target, omega, dt) {
  if (dt <= 0) return [value, velocity];
  const x = value - target;
  const e = Math.exp(-omega * dt);
  const nx = (x + (velocity + omega * x) * dt) * e;
  const nv = (velocity - omega * (velocity + omega * x) * dt) * e;
  return [target + nx, nv];
}

/** A settling scalar. */
export class Scalar {
  constructor(value = 0, settleSeconds = 0.62) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.omega = omegaFor(settleSeconds);
  }
  set(v) { this.value = this.target = v; this.velocity = 0; }
  to(v) { this.target = v; }
  step(dt) {
    [this.value, this.velocity] = step1D(this.value, this.velocity, this.target, this.omega, dt);
    return this.value;
  }
  get settled() {
    return Math.abs(this.value - this.target) < 0.01 && Math.abs(this.velocity) < 0.01;
  }
}

/* ── Ambient breathing ────────────────────────────────────────────────────
 * The tree should feel alive standing still, but breathing must never
 * accumulate into drift the way leftover simulation energy does. Three
 * properties make that safe:
 *
 *   • BOUNDED — a fixed amplitude in world units, never enough to change
 *     what the layout says;
 *   • STATELESS — a pure function of (key, time). Nothing integrates, so
 *     nothing can wander. Switch it off and everyone is exactly on target,
 *     which is a guarantee a force simulation can never make;
 *   • FAMILY-COHERENT — phase is keyed per UNIT, so a couple breathes
 *     together as one object instead of jostling each other.
 *
 * Never applied to the focus person, who must be exactly still — "nearly
 * still" is what made the old view feel unsettled.
 */
/* Amplitude was 1.5 world units over a 7.5s period — which is to say
 * roughly one pixel of travel, taking four seconds to get there. It was
 * mathematically present and visually absent, and the view read as dead
 * paper. Real feedback: "it doesn't feel alive." Raised to something you
 * can actually perceive, and given a second, slower harmonic plus a
 * per-unit period jitter so no two families breathe in lockstep — a single
 * sine at one frequency across everybody reads as a mechanism, not as life. */
export const AMBIENT_AMP = 4.6;
export const AMBIENT_PERIOD_S = 6.2;
/* A whisper of scale on the same clock. Breathing is a change in SIZE as
 * much as position, and this is what stops the drift reading as sliding. */
export const AMBIENT_SCALE = 0.012;

function phaseOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

const phaseCache = new Map();
function phasePair(key) {
  let p = phaseCache.get(key);
  if (p === undefined) {
    const a = phaseOf(key);
    // A per-unit stretch of ±12% on the period. Without it every unit
    // returns to the same place at the same moment and the whole frame
    // pulses together, which reads as one machine rather than many lives.
    const rate = 0.88 + ((Math.sin(a * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.24;
    p = { a, rate };
    phaseCache.set(key, p);
  }
  return p;
}

export function ambientOffset(unitKey, tSeconds) {
  const { a, rate } = phasePair(unitKey);
  const w = ((Math.PI * 2) / AMBIENT_PERIOD_S) * rate;
  const t = tSeconds * w;
  return {
    // Two harmonics rather than one: the second, slower and smaller, keeps
    // the path from being a clean repeating ellipse.
    x: (Math.sin(t + a) + Math.sin(t * 0.43 + a * 1.7) * 0.42) * AMBIENT_AMP * 0.72,
    y: (Math.cos(t * 0.82 + a) + Math.cos(t * 0.37 + a * 2.1) * 0.38) * AMBIENT_AMP * 0.55,
    scale: 1 + Math.sin(t * 0.61 + a * 0.7) * AMBIENT_SCALE,
  };
}

/* ── The camera ───────────────────────────────────────────────────────────
 * Composes rather than fits. The focus person sits a little below centre so
 * the ancestor branch above has room to breathe, and zoom is derived from
 * the HEARTH's own width rather than the whole frame's bounding box — the
 * frame should feel the same weight whether the person has one relative or
 * twenty.
 *
 * This returns the IDEAL composition for a frame. The fixed-point contract
 * on selection is applied by the caller, and is the other half of the trick:
 * because the focus person sits at world origin, their screen position is
 * exactly `anchor` — `anchor + (0 − 0) × zoom` — for ANY zoom. So on
 * selection the caller re-points the anchor instantly to where that person
 * already is (which costs nothing visually, since they are already there),
 * lets the zoom spring freely toward the ideal without moving them at all,
 * and only adopts the ideal anchor once the frame has finished growing —
 * a slow, deliberate settling into composition rather than a camera that
 * drags the person you just tapped across the screen.
 */
export const FOCUS_BIAS_Y = 0.08; // fraction of viewport height, below centre
export const MIN_ZOOM = 0.34;
/* How large a SMALL frame is allowed to get. Held at 1.15 initially, which
 * measured badly: a five-person frame occupied under half the width of a
 * desktop window and read as a small diagram marooned in a field of paper
 * rather than as a family you are standing in front of. Canopy deliberately
 * draws few people, so the few it draws have to earn the space — filling the
 * frame is the entire compensation for not showing everyone. */
export const MAX_ZOOM = 1.62;
/* The scale below which a person stops being recognisable — a face and a
 * name, not a coloured dot. See composeCamera: rather than shrink past this
 * to fit a wide row on a narrow screen, the frame holds this scale and lets
 * the row run off the edges to be panned to. */
// At 0.48 a 15px kin label landed at barely 7px on a phone — technically in
// frame, practically unreadable. Canopy is navigated like a map, so preserve
// legibility and let wide sibling rows extend off-screen for deliberate pan.
export const MIN_READABLE_ZOOM = 0.70;

/* The x of the family's line of descent through the focus: the focus (always
 * world 0), their parent unit, and the midpoint of their children. Averaged,
 * so no single one of them dominates. */
function spineCentre(frame) {
  const xs = [0];
  const rowMid = (row) => {
    const us = frame.units.filter((u) => u.row === row && !u.anchorOnly);
    if (!us.length) return null;
    const lo = Math.min(...us.map((u) => u.x));
    const hi = Math.max(...us.map((u) => u.x));
    return (lo + hi) / 2;
  };
  const parents = rowMid(-1);
  if (parents !== null) xs.push(parents);
  const kids = rowMid(1);
  if (kids !== null) xs.push(kids);
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function composeCamera(frame, viewport) {
  const { width: W, height: H, topInset = 0, bottomInset = 0 } = viewport;
  const safeH = Math.max(120, H - topInset - bottomInset);

  // Width to frame: the hearth plus a margin, but never narrower than the
  // widest single row — a wide sibling row must still fit even though the
  // hearth itself is narrow.
  let lo = Infinity, hi = -Infinity, top = Infinity, bot = -Infinity;
  for (const n of frame.nodes.values()) {
    const half = Math.max(n.r, n.labelHalfWidth || 0);
    lo = Math.min(lo, n.x - half); hi = Math.max(hi, n.x + half);
    top = Math.min(top, n.y - n.r);
    // The bottom of a person is their NAME, not their portrait. Framing on
    // the discs alone clipped the last row's names off the bottom edge once
    // the zoom cap was raised — the name is part of the person.
    bot = Math.max(bot, n.y + n.r + labelDrop(n.band));
  }
  if (!isFinite(lo)) return { zoom: 1, anchorX: W / 2, anchorY: H / 2 };

  const PAD = 42;
  const zx = (W - PAD * 2) / Math.max(1, hi - lo);
  const zy = (safeH - PAD * 2) / Math.max(1, bot - top);
  let zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zx, zy)));

  /* A family row is inherently wide and a phone held upright is inherently
   * narrow, so fitting the full width on a portrait screen drives the zoom
   * to its floor: measured on a 390px viewport, the whole family rendered as
   * a postage stamp marooned in a tall empty field — every person present,
   * none of them recognisable. Readability has to win that trade. Below
   * MIN_READABLE_ZOOM the frame stops trying to fit horizontally, holds a
   * legible scale, and centres on the FOCUS so the people that matter most
   * are the ones on screen; the row simply extends past both edges and is
   * panned to, exactly as a map does. */
  const centreOnFocusX = zoom < MIN_READABLE_ZOOM && zx < zy;
  if (centreOnFocusX) zoom = Math.min(MAX_ZOOM, MIN_READABLE_ZOOM);

  /* What to centre on when the row runs off the edges. Not the focus alone:
   * a parent unit is centred over the span of ALL its children, so on a wide
   * sibling row it sits far to one side of the focus, and centring on the
   * focus pushed the parents clean off the screen edge. Centre the family's
   * SPINE instead — the focus, their parents, and their children — so the
   * vertical line of descent stays in frame and the siblings are what run
   * off the edges, which is the right thing to have to pan for. */
  const spine = spineCentre(frame);
  const anchorX = centreOnFocusX
    ? W / 2 - spine * zoom
    : W / 2 - ((lo + hi) / 2) * zoom;
  const midY = (top + bot) / 2;
  const fitsVertically = (bot - top) * zoom <= safeH - PAD;
  const anchorY = topInset + safeH / 2 + safeH * FOCUS_BIAS_Y
    - (fitsVertically ? midY : 0) * zoom;

  return { zoom, anchorX, anchorY };
}

/* ── Elastic deflection ───────────────────────────────────────────────────
 * Real question from the repo owner: "should we be able to move the bubbles
 * after landing?" Free repositioning is a no — manual positions are exactly
 * what Canopy exists to get rid of, they have to be stored somewhere, and
 * they conflict with the next re-plan. They would also feel WORSE: in a
 * force layout dragging feels alive because the neighbours shove back, but
 * drag a deterministically-placed node and nothing responds at all. It is a
 * sticker you peeled off the page.
 *
 * So a person can be MOVED without being REPOSITIONED. Pull them and they
 * follow, against rising resistance; their branch bends, their partner and
 * their children sway after them; let go and the whole thing springs home.
 * Nothing is stored, the plan stays the single authority on where anybody
 * belongs, and the tree reads as connected and living rather than as a set
 * of independent counters — which is the actual thing that was missing.
 */

/** How far, in world units, a pull can ever displace someone. */
export const PULL_MAX = 86;
/** Fraction of the pull that reaches a pod partner, and a branch neighbour. */
export const SWAY_POD = 0.5;
export const SWAY_BRANCH = 0.2;

/* Rubber band: the first few pixels follow the pointer almost exactly, then
 * resistance rises and the displacement asymptotes toward PULL_MAX. A hard
 * clamp instead of a curve makes the bubble feel like it hit a wall; this
 * makes it feel attached to something. */
export function rubberBand(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return { x: 0, y: 0 };
  const eased = (PULL_MAX * d) / (PULL_MAX + d);
  return { x: (dx / d) * eased, y: (dy / d) * eased };
}

/** One person's springy offset from where the plan says they belong. */
export class Deflection {
  constructor() {
    // Quick enough to feel like tension rather than syrup, slow enough that
    // the return reads as a settle rather than a snap.
    this.x = new Scalar(0, 0.46);
    this.y = new Scalar(0, 0.46);
  }
  /** Held under the pointer — no spring while the finger is down. */
  hold(x, y) { this.x.set(x); this.y.set(y); }
  /** Pulled toward a value by something else's movement. */
  lean(x, y) { this.x.to(x); this.y.to(y); }
  /** Let go — spring home. */
  release() { this.x.to(0); this.y.to(0); }
  step(dt) { this.x.step(dt); this.y.step(dt); }
  get value() { return { x: this.x.value, y: this.y.value }; }
  get resting() {
    return Math.abs(this.x.value) < 0.05 && Math.abs(this.y.value) < 0.05
      && this.x.target === 0 && this.y.target === 0;
  }
}
