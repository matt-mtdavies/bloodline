/*
 * Canopy — the layout planner.
 *
 * A PURE function. It never sees a frame, a canvas, a velocity or a pixel:
 * it takes the graph plus who is in focus, and returns where everything
 * belongs. Same input → byte-identical output, always, which is what lets
 * every constraint below be an assertion in a test file rather than
 * something you squint at in a browser.
 *
 *   planCanopy(graph, focusId, opts) → frame
 *
 * The conceptual correction this exists to make: the organic tree asks a
 * force simulation to satisfy requirements that are not physical. "Parents
 * above children", "current partners together", "siblings in order" are
 * HARD CONSTRAINTS, and a force simulation resolves a global equilibrium in
 * which every constraint is negotiable against every other one — which is
 * why fixes for them hold on a 23-person demo and lose on a real tree.
 * Here the composition is DECIDED, once, by rule. Nothing about where a
 * person ends up is emergent.
 *
 * Guarantees (pinned by tests/canopyPlan.test.mjs):
 *   • the focus person is always exactly at world origin (0, 0);
 *   • a parent's row is strictly above every one of their children's;
 *   • current partners are members of ONE rigid pod and cannot be separated;
 *   • a former partner, and anyone who co-parented a child without ever
 *     partnering, is its own SATELLITE unit — bonded, lifted clear of the
 *     row it relates to, and never a candidate for the space inside a pod;
 *   • siblings share the focus GENERATION, in birth order across it, fanned
 *     along a circular arc below the shared baseline rather than sitting
 *     dead level — the focus and their current partner never move;
 *   • a parent unit is centred over the span of its drawn children;
 *   • units on a row never overlap (a symmetric de-overlap pass);
 *   • no Math.random, and every sort ends in an id comparison, so two
 *     people with identical data can never swap places between runs.
 *
 * THE FRAME. The most consequential decision here is refusing to draw the
 * whole tree: no layout at any quality makes 1,200 nodes readable at once.
 * Membership is derived from the focus person by RELATIONSHIP (not by a BFS
 * radius, which would sprawl unevenly through dense branches), in three
 * fidelity bands, and everything past the edge is implied by a horizon mark
 * carrying a real count rather than simply stopping.
 */

import { sortSiblings, sortChildren, ancestorsWithDistance, descendantsWithDistance, isBioOrAdoptive } from '../../data/graph.js';
import { labelDrop } from './geometry.js';

/** Vertical distance between generation rows — also the minimum clearance
 *  between a parent and their children: nothing on this row is ever placed
 *  closer to the row above or below it than this.
 * Raised from 265 once the trunk was made to start below each person's NAME
 * rather than at the edge of their portrait (see render.js's trunkSpan): that
 * left under 100px for a branch to travel, which compressed the curves into
 * steep, cramped hooks. A branch needs room to read as a sweep. */
export const ROW_GAP = 310;
/* Vertical spacing on a narrow screen.
 *
 * 310 is right on a desktop, where a branch has room to sweep. On a phone it
 * is a canyon: with Reach dropped there is nothing beside the trunk, so the
 * band between two rows renders as a long bare line through empty paper and
 * the whole frame reads as sparse and unfinished — reported as "messy".
 * A phone also cannot afford the height: the same gap pushes the outer rows
 * off-screen entirely. */
export const ROW_GAP_COMPACT = 224;
/** Centre-to-centre spacing between two people inside one partner pod. */
export const POD_GAP = 150;
/** Minimum centre-to-centre spacing between adjacent units on one row. */
export const UNIT_GAP = 208;
/* Extra clear space between two different unions' children.
 *
 * Reported against the owner's real tree: with a father's sons and a
 * step-mother's daughters on one row, the row read as one undifferentiated
 * set of four and the branches crossed. The children of one union have to
 * read as a SET — visibly a family within the family — and the cheapest way
 * to say that is a gap wider than the one between siblings. */
export const BLOCK_GAP = 96;
/** Nominal person radius at full fidelity — spacing and hit-testing use this. */
export const NODE_R = 54;

/* ── Reach clusters ───────────────────────────────────────────────────────
 * Measured against a Victorian-density tree (sibships of 3–9, which is what
 * a real 1,200-person tree actually contains, not the mean-2.2 benchmark
 * fixture): a person with nine children and fifty-one grandchildren planned
 * to a frame 8,946px wide and 1,311px tall. Every one of those grandchildren
 * was on ONE flat row, so nine fans of branches crossed each other into an
 * undifferentiated mat along the bottom edge — the "still looks wrong and
 * messy" report, reproduced exactly.
 *
 * The width of that row was governed by the number of GRANDCHILDREN, which
 * grows quadratically down the tree, when it should be governed by the number
 * of CHILDREN, which does not. So a reach-band descendant group no longer
 * spreads along the row: it hangs beneath its own parent as a compact
 * CLUSTER, a few across and a few deep. Nothing is dropped and nothing is
 * summarised — the same people are drawn, in the same order, in a shape whose
 * width is bounded. It also states the family better: each child's own family
 * reads as one bunch rather than as an anonymous stretch of the row.
 */
export const REACH_GAP = 128;
/* Vertical step between stacked ranks inside one cluster.
 *
 * Sized so a rank's horizon chip clears the rank beneath it: a grandchild
 * with descendants of their own carries a "+N" mark 96px below their centre
 * (see render.js's horizonOffset — radius, name block, then the chip), and at
 * the first value tried, 122, that chip landed on the forehead of the person
 * on the next rank down. */
export const RANK_GAP = 152;
/** A cluster grows across before it grows down, to this depth, then across. */
export const MAX_CLUSTER_RANKS = 3;
/** Clear space between one child's cluster and the next child's. */
export const CLUSTER_CLEAR = 56;

/* ── Satellites ───────────────────────────────────────────────────────────
 * A former partner, or someone who co-parented a child with the focus
 * without ever partnering them, is not a queued extra on the row — it is a
 * SATELLITE: lifted toward the ancestor direction and gathered near the pod
 * it relates to, rather than lined up flat with everyone else. That is the
 * direct answer to a real reference — a hand-drawn arrangement of the
 * owner's own tree — where an ex sits elevated and to one side of a couple's
 * pod, reading as one household with a nearby satellite relation, not as a
 * row of equally-weighted entries. This is also why organic's own arrangement
 * felt like "communities, not a hierarchy": a peripheral relation was never
 * pinned to the same strict line as the people it is peripheral TO.
 *
 * The lift is capped well short of the row above (see satelliteMaxLift in
 * planCanopy, computed from the real geometry rather than guessed), so a
 * satellite can never be mistaken for that row's own content, on a phone's
 * compact spacing as much as on desktop's.
 */
/** Extra lift per satellite beyond the first, so two or three fan upward at
 *  slightly different heights rather than stacking flat. */
export const SATELLITE_STEP = 30;
/** Clear space kept between a lifted satellite and the row above it. */
export const SATELLITE_MARGIN = 24;
/** Clear space kept between a satellite and whatever it sits beside — the
 *  focus pod, or the next satellite out. */
export const SATELLITE_GAP = 30;

/* ── The peer arc ─────────────────────────────────────────────────────────
 * A sibling row sitting dead level reads as a LIST. The reference — the
 * owner's own hand-drawn tree — showed a couple's children fanning out in a
 * circle: a bowl CRADLED beneath the pod, deepest near the centre and
 * rising back toward the baseline at the outer edges — a "U", not an "n".
 * Two earlier attempts got the shape wrong before this one, both corrected
 * from direct visual feedback rather than guessed right the first time: a
 * sine wave produced repeated up-down bumps instead of one smooth curve;
 * then a plain circular arc had the curvature backwards — shallow at the
 * centre and deepest at the edges, a dome arching AWAY from the pod rather
 * than a bowl hanging FROM it. This is the corrected shape: an actual
 * circular arc (peerArcDip), computed from each sibling's real resolved x
 * (after de-overlap has settled it, not a rank index), fed the distance
 * from the row's own CENTRE rather than from its edge. The circle's radius
 * is chosen so the row's own widest sibling reaches exactly the safe
 * amplitude, whatever that width turns out to be — a family of three fans
 * gently, a family of nine fans the same shape, just reaching further out
 * to do it.
 *
 * The focus themself never moves — the fixed-point contract pins them at
 * world origin exactly — and neither does their current partner, who is
 * level with them by construction (a rigid pod). Only the siblings gathered
 * around that pod fan.
 *
 * Always downward, never up. A downward dip can only ever travel into empty
 * space: Canopy never draws a sibling's own children, so nothing sits below
 * a sibling to collide with. Upward would reach into exactly the band a
 * satellite's own lift was carefully budgeted to keep clear (see the
 * Satellites note above) — one direction was free, the other already spoken
 * for.
 */
/** Deepest a sibling ever dips below the row-0 baseline — reached only by
 *  the row's own widest member, whatever their actual distance turns out
 *  to be. A TARGET, not a guarantee: see siblingArcMaxAmp in planCanopy,
 *  which can clamp this down on compact spacing.
 *
 * Two rounds of live feedback moved this, both because a smaller value
 * mathematically WAS a genuine curve but read as a flat line once the
 * camera did its job: 26px (under a third of a kin portrait's own ~93px
 * diameter) was invisible on a real dense family once zoomed out to fit;
 * 80px, reached only in theory at a row's exact centre, meant the row's
 * actual nearest sibling (never AT the centre) still only reached ~59px in
 * practice — still read as "tiny". The fan has to survive the zoom-out a
 * wide family actually invites, since that is exactly when it matters most,
 * so this is deliberately bold: comfortably more than a full portrait's own
 * diameter. */
export const SIBLING_ARC_AMP = 150;

/** A circular arc through the origin (0, 0) and (±xmax, amp), open
 *  downward: shallow near the centre, deepening smoothly toward the edges.
 *  `xmax` is the row's own widest sibling's |x| — the arc always spans
 *  exactly the row it's drawn for, never a fixed, arbitrary reach. */
export function peerArcDip(x, xmax, amp) {
  if (xmax <= 0) return 0;
  const r = (xmax * xmax + amp * amp) / (2 * amp);
  return r - Math.sqrt(Math.max(0, r * r - x * x));
}

/** Fidelity bands. Size, saturation and opacity all fall off together with
 *  this, so one gradient does three jobs and reads as depth rather than as
 *  three separate effects. */
export const BAND = { HEARTH: 'hearth', KIN: 'kin', REACH: 'reach' };
/** Radius multiplier per band. */
export const BAND_SCALE = { hearth: 1, kin: 0.86, reach: 0.66 };
/* The literal focus reads bigger than even their own current partner —
 * hearth band alone (focus and partner share it) already reads as "this
 * couple", but real feedback wanted the selected PERSON specifically to pop
 * the way the organic tree's own active bubble does. Applied only to the
 * one node whose id === focusId, not to the whole pod. */
export const FOCUS_SCALE = 1.16;
/* How far below the row-0 baseline the focus (and, since a pod is rigid,
 * their current partner) sits — real feedback: differentiate "this is the
 * anchor couple" from "these are peers arranged around them" the way a
 * slight vertical offset already helps the eye separate rows elsewhere.
 * Deliberately modest: siblings nearest the pod already dip toward it via
 * the peer arc below, and this only needs to read clearly for the common
 * case, not force every possible sibling arrangement into a strict order. */
export const FOCUS_Y_DROP = NODE_R * 0.65;

const isCurrent = (status) => status !== 'former';

/* Total ordering. Every comparator in this file ends in an id comparison so
 * that two people with identical (or absent) birth dates can never swap
 * places between two runs of the planner — determinism is a guarantee the
 * tests pin, not a happy accident of V8's sort being stable. */
function byBirthThenId(byId) {
  return (a, b) => {
    const pa = byId.get(a), pb = byId.get(b);
    const da = pa?.birth_date || '', db = pb?.birth_date || '';
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return String(a).localeCompare(String(b));
  };
}

/* ── Units ────────────────────────────────────────────────────────────────
 * The atom of layout is not a person, it is a UNIT: a couple pod, or a lone
 * person. A pod is RIGID — its members' offsets are fixed relative to the
 * unit's own x. That rigidity is what turns "current partners always land
 * together" from a force that can be out-muscled into a structural property
 * of the data: there is no arrangement of a planned frame in which two
 * members of one pod are not adjacent, because they are not independently
 * placed at all.
 *
 * A pod is a hub plus their CURRENT partners only. A former partner is
 * deliberately NOT a pod member: they get their own unit, joined by a
 * dashed bond and ordered outboard (see orderRow). That is the fix for the
 * reported bug where an ex could settle between two current partners — here
 * it cannot happen by construction, because the ex is never a candidate for
 * the space between them.
 */
function makeUnit(id, memberIds, band, opts = {}) {
  const offsets = new Map();
  const n = memberIds.length;
  // The gap inside a pod tracks the band's own scale. A fixed gap left a
  // Reach-band couple's capsule visibly stretched — two small discs marooned
  // at the ends of a lozenge sized for full-fidelity ones.
  const baseGap = POD_GAP * (0.55 + 0.45 * BAND_SCALE[band]);
  // A portrait is not the whole visual footprint: the name beneath it is
  // part of the person too. Long real names were colliding even though the
  // circles passed every overlap assertion. Reserve the wider of portrait
  // and label, and widen a pod when two adjacent labels need it.
  const labelHalfWidths = new Map(memberIds.map((mid) => [
    mid,
    labelHalfWidth(opts.byId?.get(mid), band, mid === opts.focusId, opts.row || 0),
  ]));
  let gap = baseGap;
  for (let i = 1; i < memberIds.length; i++) {
    gap = Math.max(gap,
      (labelHalfWidths.get(memberIds[i - 1]) || 0)
      + (labelHalfWidths.get(memberIds[i]) || 0)
      + 24);
  }
  if (opts.anchorFirst) {
    // The focus pod: the FOCUS sits at the unit's own x (and therefore at
    // world origin), not the pod's midpoint. The fixed-point contract is
    // about the person you tapped, not about the couple they belong to.
    memberIds.forEach((mid, i) => offsets.set(mid, i * gap));
  } else {
    const span = (n - 1) * gap;
    memberIds.forEach((mid, i) => offsets.set(mid, i * gap - span / 2));
  }
  return {
    id: `u:${memberIds[0]}`,
    memberIds,
    offsets,
    labelHalfWidths,
    band,
    gap,
    row: 0,
    x: 0,
    anchorId: opts.anchorId || memberIds[0],
    kind: n > 1 ? 'pod' : 'single',
  };
}

/* The name a person is drawn with, at a given fidelity.
 *
 * Exported and used by the RENDERER too, so the space the planner reserves and
 * the text the canvas sets can never disagree — they are the same string.
 *
 * A reach-band DESCENDANT is drawn with their first name only. That is a
 * fidelity decision of the same kind as the band's smaller radius, lighter
 * shadow and lower opacity: down there you are reading the SHAPE of the
 * family, a grandchild's surname is almost always the one already legible on
 * the parent directly above them, and dropping it is what lets a cluster stay
 * a cluster instead of spreading back into a mat. The full name is one tap
 * away, the moment you travel to them.
 *
 * Ancestors keep theirs. A great-grandparent's surname is not redundant with
 * anything — it is the name of the line itself, often the whole reason you
 * looked up — and there are only ever two of them per pod, so it costs no
 * width to keep. The rule is about what the width is buying, not about the
 * band as such.
 */
export function labelTextFor(person, band, row = 0) {
  const raw = (person?.display_name || 'Unknown').trim();
  const parts = raw.split(/\s+/);
  if (band === BAND.REACH && row > 0) return parts[0] || raw;
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : raw;
}

function labelHalfWidth(person, band, isFocus = false, row = 0) {
  const fontSize = isFocus ? 21 : band === BAND.REACH ? 13 : 15;
  // Pixi's Georgia metrics vary slightly by platform. This conservative
  // estimate deliberately errs toward air; the cap keeps one extreme name
  // from making an otherwise intimate family feel empty.
  return Math.min(154, Math.max(NODE_R * BAND_SCALE[band], labelTextFor(person, band, row).length * fontSize * 0.31 + 8));
}

/** Left/right visual extents, including the names beneath each portrait. */
function unitExtents(unit) {
  const r = NODE_R * BAND_SCALE[unit.band];
  let left = Infinity, right = -Infinity;
  for (const mid of unit.memberIds) {
    const x = unit.offsets.get(mid) || 0;
    const hw = Math.max(r, unit.labelHalfWidths?.get(mid) || 0);
    left = Math.min(left, x - hw);
    right = Math.max(right, x + hw);
  }
  return Number.isFinite(left) ? { left, right } : { left: 0, right: 0 };
}

/* ── Row de-overlap ───────────────────────────────────────────────────────
 * Two independently-placed groups can want the same space (two sets of
 * grandparents, or a wide sibling row under a narrow parent pod). Push them
 * apart symmetrically about the row's own centre of mass so the correction
 * never drags the whole row sideways — and never in a way that can reorder
 * anyone, since it only ever increases the gap between already-sorted
 * neighbours. Ordering is decided in orderRow and is final before this runs.
 */
function deOverlapRow(units) {
  if (units.length < 2) return;
  units.sort((a, b) => a.x - b.x || String(a.id).localeCompare(String(b.id)));
  for (let i = 1; i < units.length; i++) {
    const prev = units[i - 1], cur = units[i];
    const pe = unitExtents(prev), ce = unitExtents(cur);
    const have = (cur.x + ce.left) - (prev.x + pe.right);
    const need = 28;
    if (have < need) {
      const push = (need - have) / 2;
      // Shift both halves of the row outward, so the row keeps its centre.
      for (let j = 0; j < i; j++) units[j].x -= push;
      for (let j = i; j < units.length; j++) units[j].x += push;
    }
  }
}

function parentSet(graph, id, byId, cmp) {
  return graph.parents(id)
    .filter((p) => byId.has(p.id))
    .sort((a, b) => cmp(a.id, b.id));
}

function qualifierForParentSet(refs) {
  if (refs.some((p) => p.qualifier === 'step')) return 'step';
  if (refs.some((p) => p.qualifier === 'adoptive' || p.qualifier === 'adopted')) return 'adoptive';
  return 'biological';
}

/* ── The frame ────────────────────────────────────────────────────────────
 * Membership by relationship, in three bands. Deliberately NOT a BFS
 * radius: distance-2 through a family with eleven siblings and distance-2
 * through an only child produce wildly different amounts of content, so a
 * radius makes the frame's weight depend on which branch you happen to be
 * standing in. Naming the relationships instead makes every frame roughly
 * the same size, which is what makes every frame composable.
 */
export function planCanopy(graph, focusId, opts = {}) {
  // Narrow frames use the compact row spacing (see ROW_GAP_COMPACT). Tied to
  // the same flag that drops the Reach band, so a phone gets one coherent
  // compact composition rather than two independent adjustments.
  /* Compact row spacing is asked for either by a narrow frame (a phone
   * cannot afford the canyon) or explicitly by the caller, when the standard
   * spacing would make the composition taller than the screen it has to be
   * legible on. Same spacing, two reasons to want it. */
  const rowGap = (opts.compact || opts.includeReach === false) ? ROW_GAP_COMPACT : ROW_GAP;
  const byId = graph.byId;
  const focus = byId.get(focusId);
  const cmp = byBirthThenId(byId);
  const drawn = new Set();
  const units = [];
  const bonds = [];
  const horizons = [];

  if (!focus) {
    return { focusId, nodes: new Map(), units: [], bonds: [], horizons: [], rows: new Map(), bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  }

  const claim = (id) => { if (drawn.has(id)) return false; drawn.add(id); return true; };
  const newUnit = (id, memberIds, band, unitOpts = {}) =>
    makeUnit(id, memberIds, band, { ...unitOpts, byId, focusId });
  const partnersOf = (id, current) =>
    graph.partners(id).filter((pt) => (current ? isCurrent(pt.status) : !isCurrent(pt.status)) && byId.has(pt.id)).map((pt) => pt.id);
  const anchors = new Map();
  const ensureAnchor = (refs, row, band) => {
    const ids = refs.map((p) => p.id).filter((id) => byId.has(id)).sort(cmp);
    const key = `${row}:${ids.join('|')}`;
    if (anchors.has(key)) return anchors.get(key);
    const u = {
      id: `a:${key}`,
      memberIds: [],
      anchorMemberIds: ids,
      offsets: new Map(),
      labelHalfWidths: new Map(),
      band,
      row,
      x: 0,
      anchorId: ids[0],
      kind: 'junction',
      anchorOnly: true,
    };
    anchors.set(key, u);
    units.push(u);
    return u;
  };
  const unionSeen = new Set();
  // Returns whether a real partner edge was found and (first time) drawn —
  // the co-parent loop below needs to know when it must fall back to a plain
  // link instead, for two people who share a child but never partnered.
  const addUnion = (a, b) => {
    const edge = graph.partners(a).find((p) => p.id === b);
    if (!edge) return false;
    const key = [a, b].sort().join('|');
    if (unionSeen.has(key)) return true;
    unionSeen.add(key);
    bonds.push({ kind: 'union', a, b, status: isCurrent(edge.status) ? 'current' : 'former' });
    return true;
  };

  /* ROW 0 — the focus pod. The focus person is claimed first and anchors the
   * whole composition at world origin. */
  claim(focusId);
  const focusCurrent = partnersOf(focusId, true).filter(claim).sort(cmp);
  const focusUnit = newUnit(focusId, [focusId, ...focusCurrent], BAND.HEARTH, { anchorFirst: true, anchorId: focusId });
  focusUnit.row = 0;
  focusUnit.x = 0;
  units.push(focusUnit);
  for (const pid of focusCurrent) addUnion(focusId, pid);

  /* Former partners of the focus: their own units, ordered outboard by
   * orderRow. A genuine ex sits directly beside the focus — same row
   * baseline, no lift — so they read as a "was a couple" pod adjacent to the
   * person, not a queued extra floating above the row. formerPartner marks
   * this for the satellite-lift pass below. */
  const focusFormer = partnersOf(focusId, false).filter(claim).sort(cmp);
  const formerUnits = focusFormer.map((pid) => {
    const u = newUnit(pid, [pid], BAND.KIN);
    u.row = 0;
    u.outboard = true;
    u.satellite = true;
    u.formerPartner = true;
    units.push(u);
    addUnion(focusId, pid);
    return u;
  });

  /* ROW +1 — children. Every child of the focus (by any partner), in the
   * app's own display order (tier, then age, then name). */
  const childRefs = sortChildren(graph.children(focusId).filter((c) => byId.has(c.id)), byId);
  const childUnits = [];
  const coParentUnits = [];
  const childAnchor = new Map();
  for (const c of childRefs) {
    const refs = parentSet(graph, c.id, byId, cmp);
    // A child can have a recorded co-parent without a partner edge. The
    // relationship is still true and must be visible, so include that person
    // as context instead of silently routing the child through whichever
    // partner happens to be inside the focus pod.
    for (const ref of refs) {
      if (ref.id === focusId || drawn.has(ref.id)) continue;
      claim(ref.id);
      const pu = newUnit(ref.id, [ref.id], BAND.KIN);
      pu.row = 0;
      pu.coParent = true;
      pu.satellite = true;
      units.push(pu);
      coParentUnits.push(pu);
      // A real partner edge (current or former) draws its own union bond.
      // With none, they are still visibly linked — just never as a former
      // COUPLE, which is not what this relationship is.
      if (!addUnion(focusId, ref.id)) bonds.push({ kind: 'thread', a: focusId, b: ref.id });
    }
    if (!claim(c.id)) continue;
    const u = newUnit(c.id, [c.id], BAND.HEARTH);
    u.row = 1;
    u.qualifier = c.qualifier || 'biological';
    units.push(u);
    childUnits.push(u);
    // The branch belongs to this child's exact recorded parent set. This is
    // deliberately child-specific: one broad focus+partners capsule cannot
    // truthfully represent a blended family.
    const anchor = ensureAnchor(refs, 0, BAND.HEARTH);
    childAnchor.set(c.id, anchor);
    bonds.push({ kind: 'descent', parentUnit: anchor.id, child: c.id, qualifier: qualifierForParentSet(refs) });
  }

  /* ROW 0 — siblings, placed across the focus row in birth order. Putting
   * elder siblings to the left of the focus and younger to the right makes
   * the row itself read chronologically, which is a free piece of legibility
   * that a force layout can never offer. */
  const sibRefs = sortSiblings(graph.siblings(focusId).filter((s) => byId.has(s.id)), byId);
  const sibUnits = [];
  for (const s of sibRefs) {
    if (!claim(s.id)) continue;
    const u = newUnit(s.id, [s.id], BAND.KIN);
    u.row = 0;
    u.kindOfSibling = s.kind;
    units.push(u);
    sibUnits.push(u);
  }

  /* ROW -1 — exact parent sets.
   *
   * The previous planner made one parent pod from the focus's first two
   * parents, then routed EVERY sibling through it. That is how a partner who
   * was not somebody's mother could visually become their mother. We still
   * place real partnered parents together, but each child descends from an
   * exact, child-specific junction derived from their own parent edges. */
  const parentRefs = parentSet(graph, focusId, byId, cmp);
  const parentIds = parentRefs.map((p) => p.id);
  const parentDisplayUnits = [];
  const parentPersonUnit = new Map();

  const ensureParentPerson = (id) => {
    if (parentPersonUnit.has(id)) return parentPersonUnit.get(id);
    // Pedigree collapse and malformed imports can make one person reachable
    // in more than one role. A portrait is still rendered once: reuse any
    // existing visual unit and let the exact junction carry the second role.
    const existing = units.find((u) => !u.anchorOnly && u.memberIds.includes(id));
    if (existing) { parentPersonUnit.set(id, existing); return existing; }
    claim(id);
    const u = newUnit(id, [id], BAND.KIN);
    u.row = -1;
    units.push(u);
    parentDisplayUnits.push(u);
    parentPersonUnit.set(id, u);
    return u;
  };

  // The selected person's own partnered parents form the primary pod. More
  // than two recorded parents remain separate rather than being swallowed
  // into one shape that implies a group partnership.
  const consumedParents = new Set();
  for (const a of parentIds) {
    if (consumedParents.has(a)) continue;
    const alreadyVisible = units.find((u) => !u.anchorOnly && u.memberIds.includes(a));
    if (alreadyVisible) {
      consumedParents.add(a);
      parentPersonUnit.set(a, alreadyVisible);
      continue;
    }
    const b = parentIds.find((id) => id !== a && !consumedParents.has(id) && !drawn.has(id)
      && graph.partners(a).some((pt) => pt.id === id));
    const members = b ? [a, b].sort(cmp) : [a];
    members.forEach((id) => { consumedParents.add(id); claim(id); });
    const u = newUnit(members[0], members, BAND.KIN);
    u.row = -1;
    units.push(u);
    parentDisplayUnits.push(u);
    for (const id of members) parentPersonUnit.set(id, u);
    if (b) addUnion(a, b);
  }
  // Two of the focus's own recorded parents who never partnered (co-parents
  // without a partnership — the same relationship the child row and the
  // sibling row both already draw a plain thread for) still have to read as
  // CONNECTED, not as two strangers who happen to share a row. Pairwise
  // rather than a single check, since more than two recorded parents is a
  // real, if rare, shape this file already accounts for above.
  for (let i = 0; i < parentIds.length; i++) {
    for (let j = i + 1; j < parentIds.length; j++) {
      if (!addUnion(parentIds[i], parentIds[j])) {
        bonds.push({ kind: 'thread', a: parentIds[i], b: parentIds[j] });
      }
    }
  }

  const focusParentAnchor = parentRefs.length ? ensureAnchor(parentRefs, -1, BAND.KIN) : null;
  if (focusParentAnchor) {
    bonds.push({
      kind: 'descent',
      parentUnit: focusParentAnchor.id,
      child: focusId,
      qualifier: qualifierForParentSet(parentRefs),
    });
  }

  // Every sibling is routed through THEIR parents. Half/step siblings can
  // introduce another co-parent on this row, but never inherit the focus's
  // other parent merely because it makes a tidier picture.
  for (const u of sibUnits) {
    const sid = u.memberIds[0];
    const refs = parentSet(graph, sid, byId, cmp);
    const refUnits = refs.map((ref) => ensureParentPerson(ref.id));
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        // A real partner edge draws its own union bond. Without one — two
        // people who co-parented this sibling but never partnered — they
        // still have to read as CONNECTED, or the render is simply missing a
        // line between two people the data plainly relates. The child row
        // already draws this same fallback (see the co-parent loop above);
        // row -1 sharing a sibling instead of a child is not a reason to
        // drop it.
        if (!addUnion(refs[i].id, refs[j].id)) {
          bonds.push({ kind: 'thread', a: refs[i].id, b: refs[j].id });
        }
      }
    }
    // A sibling's OTHER parent — introduced here for the first time, and not
    // one of the focus's own two — belongs directly beside whichever
    // already-drawn row -1 person they actually share a UNION with (a real
    // partner edge, current or former), on the opposite side from that
    // person's own drawn partner. The same "adjacent, opposite side" rule
    // row 0 already applies to the focus's own former partners, extended to
    // this row. The anchor search used to be scoped to literally the focus's
    // own two recorded parents, which missed a real shape: a step-parent's
    // own partner, introduced via a DIFFERENT sibling, who never happens to
    // union with the focus's own parent directly. Any already-drawn row -1
    // person is a valid anchor now, not just those two. Deliberately still
    // gated on a genuine partner edge (addUnion having actually drawn a
    // union bond) — a pure co-parent with no partnership is a real but
    // different relationship (see the thread fallback just above) and
    // snapping them "beside, opposite the partner" would visually claim a
    // couple that never existed. Without this rule at all, a parent's former
    // partner lands wherever "centred over my own children" happens to put
    // them, which can cross the real pod's own lines and read as belonging
    // to the wrong parent — a real report, with a screenshot.
    for (let i = 0; i < refs.length; i++) {
      const rid = refs[i].id;
      if (parentIds.includes(rid)) continue;
      const ru = refUnits[i];
      if (!ru || ru._adjacentAnchor) continue;
      const anchorId = [...parentPersonUnit.keys()].find((pid) => pid !== rid
        && graph.partners(pid).some((pt) => pt.id === rid));
      if (!anchorId) continue;
      const anchorUnit = parentPersonUnit.get(anchorId);
      if (!anchorUnit || anchorUnit === ru) continue;
      ru._adjacentAnchor = { unit: anchorUnit, memberId: anchorId };
    }
    if (!refs.length) continue;
    const anchor = ensureAnchor(refs, -1, BAND.KIN);
    bonds.push({
      kind: 'descent',
      parentUnit: anchor.id,
      child: sid,
      qualifier: qualifierForParentSet(refs),
    });
  }

  /* Any already-drawn row -1 person's OWN partners — current or former —
   * belong beside them too, not only the ones discovered because they
   * co-parented a displayed sibling. The rule above only pulls in a parent's
   * ex when that ex ALSO shares a rendered child; a person connected purely
   * by a past or present partnership, with no shared child on screen at all,
   * never made it onto the canvas at all. Real report, with a screenshot,
   * against a real 1,200-person tree: several of exactly this shape, each
   * left to its own independently-computed position and joined after the
   * fact by a line that has to travel however far apart the two ended up —
   * "the lines are hard to read."
   *
   * A fixed snapshot of the row taken BEFORE this loop starts (`[...
   * parentDisplayUnits]`) — newly-added satellites are not themselves
   * searched for further partners. One level only, deliberately: chasing a
   * satellite's own further exes would let one prolifically-married ancestor
   * pull in an unbounded, ever-deepening fan, which is exactly the kind of
   * runaway growth Canopy's whole banded-frame design exists to avoid.
   *
   * The cap is PER PERSON, not per pod: it started as one shared budget
   * across a pod's two members, and a pod's FIRST member alone could then
   * exhaust it, silently hiding the SECOND member's own, completely
   * unrelated ex — one real person's history erased by another's. Each
   * member of a pod gets their own budget. */
  const MAX_EXTRA_PARTNERS_PER_ANCHOR = 2;
  for (const anchorUnit of [...parentDisplayUnits]) {
    for (const memberId of anchorUnit.memberIds) {
      let added = 0;
      const extras = graph.partners(memberId)
        .filter((pt) => byId.has(pt.id) && !drawn.has(pt.id))
        .sort((a, b) => cmp(a.id, b.id));
      for (const pt of extras) {
        if (added >= MAX_EXTRA_PARTNERS_PER_ANCHOR) break;
        claim(pt.id);
        const pu = newUnit(pt.id, [pt.id], BAND.KIN);
        pu.row = -1;
        units.push(pu);
        parentDisplayUnits.push(pu);
        parentPersonUnit.set(pt.id, pu);
        addUnion(memberId, pt.id);
        pu._adjacentAnchor = { unit: anchorUnit, memberId };
        added++;
      }
    }
  }

  /* ROW -2 — grandparents, one pod per parent, at Reach fidelity.
   *
   * The Reach band is dropped entirely on a narrow viewport. This is a real
   * design decision, not a degradation: measured on a 390px phone, a frame
   * with Reach is five units wide, which forces the zoom to the floor and
   * leaves the whole family stranded as a postage stamp in the middle of a
   * tall screen — legible in principle, unreadable in fact. Hearth + Kin is
   * three rows and a narrower row, so it fills a portrait screen properly.
   * Nothing is lost: what Reach would have drawn is stated by a horizon
   * mark instead, and the whole navigation model is that you travel to see
   * more. On a phone you simply travel a little more often. */
  const grandUnits = [];
  if (focusParentAnchor && opts.includeReach !== false) {
    // A step-parent belongs on the parent row — that relationship is real and
    // worth showing. Their OWN parents are a different matter: that is the
    // step-parent's blood family, not the focus's, and drawing them with the
    // same weight as a real grandparent pod is exactly how a stranger's
    // ancestry can read as your own. isBioOrAdoptive is the one shared rule
    // bloodRelativesOf, relationshipCategories, and PersonSheet already
    // apply for exactly this boundary — Canopy calls the same function
    // rather than keeping its own copy that can silently fall out of step.
    for (const pRef of parentRefs) {
      if (!isBioOrAdoptive(pRef.qualifier)) continue;
      const pid = pRef.id;
      const gRefs = graph.parents(pid).filter((g) => byId.has(g.id));
      const gIds = gRefs.map((g) => g.id).sort(cmp);
      if (!gIds.length) continue;
      const [ga, gb] = gIds;
      const partnered = gb && graph.partners(ga).some((pt) => pt.id === gb);
      const members = (partnered ? [ga, gb] : [ga]).filter(claim);
      if (!members.length) continue;
      const gu = newUnit(members[0], members, BAND.REACH);
      gu.row = -2;
      gu.childId = pid; // centred over the parent they produced
      units.push(gu);
      grandUnits.push(gu);
      if (members.length > 1) addUnion(members[0], members[1]);
      const shownGrandparents = gRefs.filter((g) => drawn.has(g.id));
      const gAnchor = ensureAnchor(shownGrandparents, -2, BAND.REACH);
      bonds.push({ kind: 'descent', parentUnit: gAnchor.id, child: pid, qualifier: qualifierForParentSet(gRefs) });
    }
  }

  /* ROW +2 — grandchildren, at Reach fidelity, grouped under their own
   * parent so the descent reads correctly rather than as a flat row. */
  const grandChildUnits = [];
  /* Grouped as they are created, because the CHILD row's spacing depends on
   * how wide each child's cluster will be (see childSpacing below) and that
   * row is placed first. */
  const byParent = new Map();
  /* Descendants are drawn on a narrow frame TOO.
   *
   * Reach used to be dropped wholesale below REACH_MIN_WIDTH, and the reason
   * given was width: a grandchild row spread along the row made the frame
   * five units wide and drove the zoom to its floor. Clusters removed that
   * reason — a cluster hangs beneath its own parent and adds no width at all.
   * What the drop left behind was a phone screen with two rows of content and
   * a third of it empty paper, which is the "sparse and unfinished" half of
   * the same report. Ancestors are still dropped on a narrow frame: a second
   * pod per parent DOES widen the row, and it widens it upward, away from the
   * direction a phone is usually travelling. */
  for (const cu of childUnits) {
    const cid = cu.memberIds[0];
    const gcRefs = sortChildren(graph.children(cid).filter((g) => byId.has(g.id)), byId);
    for (const gc of gcRefs) {
      if (!claim(gc.id)) continue;
      const gu = newUnit(gc.id, [gc.id], BAND.REACH, { row: 2 });
      gu.row = 2;
      gu.parentId = cid;
      units.push(gu);
      grandChildUnits.push(gu);
      if (!byParent.has(cid)) byParent.set(cid, []);
      byParent.get(cid).push(gu);
      bonds.push({ kind: 'descent', parentUnit: cu.id, child: gc.id, qualifier: gc.qualifier || 'biological' });
    }
  }

  /* ── Placement ──────────────────────────────────────────────────────────
   * Each row is placed against the row it hangs from, then de-overlapped.
   * Order within a row is decided before any x is assigned, so de-overlap
   * can only ever widen gaps — it can never reorder anybody. */

  /* Row 0 — the focus, their partners, and their siblings.
   *
   * PAST TO THE LEFT of the focus, PRESENT TO THE RIGHT — former partners
   * and other co-parents (together, the SATELLITES) go on the opposite side
   * from the current pod, never outboard of it.
   *
   * This is not a stylistic choice — it is the fix for a real defect. A
   * child's branch is anchored on the midpoint between their two actual
   * parents. With an ex placed OUTBOARD of the current partner, that midpoint
   * lands squarely on the current partner, and the trunk carrying two boys
   * down to their own mother and father appeared to descend out of their
   * mother's new husband instead (reported on the owner's tree: the line to
   * Matthew and Jason seemed to come from Ken). Putting each partner on their
   * own side of the focus puts each union's midpoint on its own side too, so
   * a union anchor can never land on a third person.
   *
   * Satellites are LIFTED off the row rather than queued along it — see the
   * "Satellites" note above — so they no longer consume row-width the way a
   * same-row unit would: siblings sit exactly as close to the focus as their
   * own count requires, not pushed out by however many satellites there are.
   * The lift is capped from the real geometry, not guessed, so it clears the
   * row above with margin on both the standard and the compact spacing.
   *
   * Horizontal placement is measured against the focus pod's REAL footprint
   * (portrait or name, whichever is wider — unitExtents, same measure the
   * rest of this file already trusts), not a fixed multiple of UNIT_GAP. A
   * fixed multiple was tried first and put a long-named ex's own label
   * overlapping a long-named focus's — two names that happen to be short
   * left a wide, arbitrary gap; two names that happen to be long collided
   * outright. Measuring the actual space each name needs is what a hard-coded
   * fraction can never get right for every name in a real tree.
   */
  const focusRight = (focusUnit.memberIds.length - 1) * focusUnit.gap; // right edge of the focus pod

  const elder = [], younger = [];
  for (const u of sibUnits) (cmp(u.memberIds[0], focusId) < 0 ? elder : younger).push(u);
  elder.sort((a, b) => cmp(b.memberIds[0], a.memberIds[0])); // nearest-in-age first, going left
  younger.sort((a, b) => cmp(a.memberIds[0], b.memberIds[0]));
  elder.forEach((u, i) => { u.x = -(i + 1) * UNIT_GAP; });
  younger.forEach((u, i) => { u.x = focusRight + (i + 1) * UNIT_GAP; });
  deOverlapRow([focusUnit, ...sibUnits]);
  /* The arc is computed from each sibling's REAL, final x — only known once
   * de-overlap has settled the row — not a rank index. A long name pushing
   * its neighbours further apart changes actual on-screen distance, and the
   * arc has to answer to that, or a wide name would sit on a curve meant for
   * a narrower one. */
  if (sibUnits.length) {
    const xmax = Math.max(...sibUnits.map((u) => Math.abs(u.x)));
    /* The bold target amplitude is capped from real geometry, not trusted
     * blind — a deeply-dipping sibling near the centre sits close to where
     * the FOCUS's own children are anchored one row down, and on compact
     * spacing (a short ROW_GAP_COMPACT) that headroom is genuinely tight.
     * A HEARTH-band child's own top edge (no label above it, same reasoning
     * as the focus pod's in the Satellites note) is the nearest thing below
     * to stay clear of. */
    const hearthR = NODE_R * BAND_SCALE[BAND.HEARTH];
    const kinR = NODE_R * BAND_SCALE[BAND.KIN];
    const siblingArcMaxAmp = Math.max(
      24,
      rowGap - hearthR - kinR - labelDrop(BAND.KIN) - SATELLITE_MARGIN,
    );
    const amp = Math.min(SIBLING_ARC_AMP, siblingArcMaxAmp);
    // A bowl CRADLED under the pod, not a dome rising over it: deepest
    // near the centre (directly under where the parent pod sits — see the
    // row -1 centring rule below, which lands them close to here) and
    // rising back toward the row-0 baseline at the outer edges, the same
    // way the reference's fanned children read as hanging FROM their
    // parents rather than arching away from them. peerArcDip already
    // measures "how deep at this distance from an edge" — feeding it the
    // distance from the CENTRE instead flips which end is deepest.
    for (const u of sibUnits) u.arcDip = peerArcDip(xmax - Math.abs(u.x), xmax, amp);
  }

  /* Satellites are placed only NOW, once the row above has fully settled —
   * de-overlapping the focus against its siblings can itself shift the focus
   * pod's own x (a younger sibling's initial guess can overlap it before
   * resolution), and a satellite has to gather next to where the row ACTUALLY
   * ended up, not where it started.
   *
   * The lift is computed to clear row 0's TALLEST content — the hearth-band
   * focus pod, which reaches further up than a kin-band sibling does — so
   * once a satellite clears the pod it has, for free, also cleared every
   * sibling beside it, at ANY horizontal distance: their vertical extent is
   * strictly smaller. That is what actually lets a satellite sit close, the
   * way the reference does, rather than needing to be pushed out past
   * whichever siblings happen to be nearby.
   *
   * It cannot always reach that far, though: the same lift is capped short of
   * row -1 above (satelliteMaxLift), and on a phone's compact spacing the two
   * requirements can genuinely conflict — there is not enough vertical room
   * between the rows to fully clear a tall focus pod AND stay off row -1. In
   * that one case, and only that case, horizontal clearance is measured
   * against the WHOLE settled row (every sibling, not just the pod) instead
   * of the pod alone — the fallback a fixed lift can't buy its way out of. */
  // The focus's UPWARD extent has no label reservation — nothing sits above
  // a portrait — so clearing it needs only its own radius, not its
  // labelDrop too (that guards its bottom edge, a different comparison).
  const kinR = NODE_R * BAND_SCALE[BAND.KIN];
  const hearthClearLift = NODE_R * BAND_SCALE[BAND.HEARTH] + SATELLITE_MARGIN + kinR + labelDrop(BAND.KIN);
  const satelliteMaxLift = Math.max(48, rowGap - 2 * kinR - labelDrop(BAND.KIN) - SATELLITE_MARGIN);
  const baseLift = Math.min(hearthClearLift, satelliteMaxLift);
  const liftClearsWholeRow = baseLift >= hearthClearLift - 1e-6;
  const satellites = [...formerUnits, ...coParentUnits];
  const clearanceUnits = liftClearsWholeRow ? [focusUnit] : [focusUnit, ...sibUnits];
  const row0LeftEdge = Math.min(...clearanceUnits.map((u) => u.x + unitExtents(u).left));
  let satelliteEdge = row0LeftEdge - SATELLITE_GAP;
  satellites.forEach((u, i) => {
    const halfWidth = Math.max(NODE_R * BAND_SCALE[u.band], u.labelHalfWidths.get(u.memberIds[0]) || 0);
    satelliteEdge -= halfWidth;
    u.x = satelliteEdge;
    satelliteEdge -= halfWidth + SATELLITE_GAP; // clear space before the next one, too
    // A genuine former partner (formerPartner) sits directly beside the
    // focus at the row's own baseline — no lift — so the render's adjacent
    // dashed-pod treatment (see render.js) reads as "beside", not "above and
    // apart". A co-parent who never partnered keeps the lift: that
    // relationship really is more peripheral, and stays a plain thread.
    u.satelliteLift = u.formerPartner ? 0 : Math.min(baseLift + i * SATELLITE_STEP, satelliteMaxLift);
  });

  /* Row +1 — UNION BLOCKS.
   *
   * The rework this view needed. Each union's children are laid out as ONE
   * CONTIGUOUS BLOCK, and blocks are ordered by their own anchor's position,
   * so two unions' children can never interleave.
   *
   * The previous pass centred every group independently on its own anchor and
   * then de-overlapped the whole row. That is subtly but fatally different:
   * two anchors close together produced two groups occupying the same span,
   * and de-overlap only widens gaps between neighbours — it cannot un-shuffle
   * an already-interleaved row. Reported on the owner's real tree as
   * "Jessica, Matthew, Amie, Jason" — step-daughter, son, step-daughter, son
   * — with branches crossing over each other. No amount of line-drawing
   * fixes that; the order itself was wrong.
   *
   * Blocks are placed by a single left-to-right sweep: each starts where it
   * wants to be (under its own parents) and is pushed right only far enough
   * to clear the block before it. Order is therefore decided before any x is
   * assigned and can never be disturbed by the spacing pass.
   */
  const childGroups = new Map();
  for (const cu of childUnits) {
    const anchor = childAnchor.get(cu.memberIds[0]);
    if (!anchor) continue;
    if (!childGroups.has(anchor.id)) childGroups.set(anchor.id, { anchor, units: [] });
    childGroups.get(anchor.id).units.push(cu);
  }

  const anchorX = (anchor) => {
    const xs = anchor.anchorMemberIds.map((id) => {
      const u = units.find((candidate) => !candidate.anchorOnly && candidate.memberIds.includes(id));
      return u ? u.x + (u.offsets.get(id) || 0) : null;
    }).filter(Number.isFinite);
    return xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : 0;
  };

  const blocks = [...childGroups.values()]
    .map((g) => ({ ...g, cx: anchorX(g.anchor) }))
    // Ordered by where their parents actually are, so a block never has to
    // reach across another to find its own union.
    .sort((a, b) => a.cx - b.cx || String(a.anchor.id).localeCompare(String(b.anchor.id)));

  // Uses the units' real visual footprint (portrait OR name, whichever is
  // wider — see unitExtents), so a block of long-named children reserves the
  // space its labels actually occupy rather than the space its discs do.
  const halfOf = (u, side) => {
    const e = unitExtents(u);
    return side === 'left' ? -e.left : e.right;
  };
  /* A child is spaced by what hangs BENEATH them, not only by their own
   * portrait and name.
   *
   * The first cut of the cluster rework bounded each cluster's width but
   * still spaced the children above them at a flat UNIT_GAP — so a cluster
   * three across sat wider than its parent's own slot, and eight clusters ran
   * together into a single unbroken line of twenty grandchildren with the
   * branches crossing over each other to reach them. Bounding the cluster is
   * only half the job: the row above has to leave room for it, or the
   * grouping the cluster exists to express is invisible.
   *
   * This is one level of the classic tidy-tree contour rule, which is all
   * that is needed here — the frame is exactly two generations deep below the
   * focus, so a child's subtree is its cluster and nothing more. */
  const clusterHalfWidth = (u) => {
    const group = byParent.get(u.memberIds[0]);
    if (!group?.length) return 0;
    const cols = group.length <= 2 ? group.length : Math.max(2, Math.ceil(group.length / MAX_CLUSTER_RANKS));
    const widest = Math.max(...group.map((gu) => halfOf(gu, 'right')), 0);
    return ((cols - 1) * REACH_GAP) / 2 + widest;
  };
  const childSpacing = (a, b) => Math.max(
    UNIT_GAP,
    halfOf(a, 'right') + halfOf(b, 'left') + 28,
    clusterHalfWidth(a) + clusterHalfWidth(b) + CLUSTER_CLEAR,
  );
  const blockWidth = (g) => {
    const n = g.units.length;
    if (!n) return 0;
    let w = halfOf(g.units[0], 'left') + halfOf(g.units[n - 1], 'right');
    for (let i = 1; i < n; i++) w += childSpacing(g.units[i - 1], g.units[i]);
    return w;
  };

  let prevRight = -Infinity;
  for (const g of blocks) {
    const w = blockWidth(g);
    let left = g.cx - w / 2;
    if (left < prevRight + BLOCK_GAP) left = prevRight + BLOCK_GAP;
    let x = left + halfOf(g.units[0], 'left');
    g.units.forEach((u, i) => {
      if (i) x += childSpacing(g.units[i - 1], g.units[i]);
      u.x = x;
    });
    prevRight = left + w;
    g._left = left;
    g._width = w;
  }
  /* The sweep only ever pushes RIGHT, so a crowded row drifts off its
   * parents. Slide the whole run back so its centre sits under the mean of
   * the unions that produced it — a rigid shift, so it cannot reorder or
   * re-overlap anything the sweep just resolved. */
  if (blocks.length) {
    const runLeft = blocks[0]._left;
    const runRight = blocks[blocks.length - 1]._left + blocks[blocks.length - 1]._width;
    const wantCentre = blocks.reduce((sum, g) => sum + g.cx, 0) / blocks.length;
    const shift = wantCentre - (runLeft + runRight) / 2;
    if (shift !== 0) for (const g of blocks) for (const u of g.units) u.x += shift;
  }

  deOverlapRow(childUnits);

  // Row +2: each grandchild group hangs beneath its own parent as a compact
  // cluster (see REACH_GAP) rather than spreading along the row.
  for (const [pid, group] of byParent) {
    const pu = childUnits.find((u) => u.memberIds[0] === pid);
    clusterUnder(group, pu ? pu.x : 0);
  }
  // Two people on different ranks of a cluster are already a rank apart
  // vertically and cannot collide, so de-overlap runs per rank. Doing it
  // across the whole row would treat a deliberate stack as a pile-up and
  // shove the clusters out into exactly the flat row they exist to avoid.
  for (const rank of new Set(grandChildUnits.map((u) => u.rank || 0))) {
    deOverlapRow(grandChildUnits.filter((u) => (u.rank || 0) === rank));
  }

  // Row -1: the parent unit is centred over the span of its drawn children
  // (the focus plus every drawn sibling) — the classic tidy-tree rule, and
  // the one that makes a family read as a family rather than as a list.
  const row1Units = [focusUnit, ...sibUnits];
  if (parentDisplayUnits.length) {
    const desired = new Map(parentDisplayUnits.map((u) => [u, []]));
    const childUnitsById = new Map(row1Units.map((u) => [u.memberIds[0], u]));
    const rowChildren = [focusId, ...sibUnits.map((u) => u.memberIds[0])];
    for (const cid of rowChildren) {
      const cu = childUnitsById.get(cid);
      if (!cu) continue;
      const refs = parentSet(graph, cid, byId, cmp);
      for (const ref of refs) {
        const pu = parentPersonUnit.get(ref.id);
        if (pu) desired.get(pu)?.push(cu.x);
      }
    }
    for (const [u, xs] of desired) {
      if (!xs.length) continue;
      // The selected person's parents belong over the selected person, not
      // over the midpoint of an arbitrarily wide sibling row. The earlier
      // tidy-tree centring pushed one or both parents off a phone screen — a
      // structurally neat diagram that failed the actual navigation task.
      // Secondary parent units introduced by half-siblings still follow the
      // children they actually produced.
      const isFocusParentUnit = u.memberIds.some((id) => parentIds.includes(id));
      const target = isFocusParentUnit
        ? focusUnit.x + (focusUnit.offsets.get(focusId) || 0)
        : xs.reduce((sum, x) => sum + x, 0) / xs.length;
      const memberMid = u.memberIds.length > 1
        ? (Math.min(...u.memberIds.map((id) => u.offsets.get(id))) + Math.max(...u.memberIds.map((id) => u.offsets.get(id)))) / 2
        : 0;
      u.x = target - memberMid;
    }
  }
  // Snap any "adjacent former partner" unit into position now that the
  // primary parent pods have their final x — placed opposite the anchor's
  // own drawn partner, overriding the generic "centred over my own children"
  // position just assigned above (see the sibling loop that tagged this).
  for (const pu of parentDisplayUnits) {
    if (!pu._adjacentAnchor) continue;
    const { unit: anchorUnit, memberId } = pu._adjacentAnchor;
    const anchorX = anchorUnit.x + (anchorUnit.offsets.get(memberId) || 0);
    const otherMemberId = anchorUnit.memberIds.find((id) => id !== memberId);
    const otherX = otherMemberId != null ? anchorUnit.x + (anchorUnit.offsets.get(otherMemberId) || 0) : null;
    const direction = otherX != null ? (Math.sign(anchorX - otherX) || -1) : -1;
    pu.x = anchorX + direction * Math.max(anchorUnit.gap || POD_GAP, POD_GAP);
  }
  deOverlapRow(parentDisplayUnits);

  // Row -2: each grandparent pod centred over the parent it produced.
  for (const gu of grandUnits) {
    const pu = parentPersonUnit.get(gu.childId);
    const target = pu ? pu.x + (pu.offsets.get(gu.childId) || 0) : 0;
    gu.x = target;
  }
  deOverlapRow(grandUnits);

  /* ── Horizon marks ──────────────────────────────────────────────────────
   * Past the Reach band a branch does not simply stop — it terminates in a
   * mark carrying a real count, so the frame states what it is not showing
   * instead of quietly implying the family ends here. */
  const addHorizon = (anchorUnit, dir, count) => {
    if (count > 0) horizons.push({ id: `h:${anchorUnit.id}:${dir}`, unitId: anchorUnit.id, dir, count });
  };
  for (const gu of grandUnits) {
    // Deduped across the pod: two grandparents who share an ancestor
    // (pedigree collapse — cousins who married, which real trees do contain)
    // must not have that person counted twice.
    const beyondIds = new Set();
    for (const mid of gu.memberIds) {
      for (const [aid, v] of ancestorsWithDistance(graph, mid, 8)) {
        if (v.distance > 0) beyondIds.add(aid);
      }
    }
    addHorizon(gu, 'up', beyondIds.size);
  }
  for (const su of sibUnits) {
    const desc = descendantsWithDistance(graph, su.memberIds[0], 6);
    let beyond = 0;
    for (const [, v] of desc) if (v.distance > 0) beyond++;
    addHorizon(su, 'down', beyond);
  }
  for (const gu of grandChildUnits) {
    const desc = descendantsWithDistance(graph, gu.memberIds[0], 6);
    let beyond = 0;
    for (const [, v] of desc) if (v.distance > 0) beyond++;
    addHorizon(gu, 'down', beyond);
  }
  /* With Reach dropped (narrow viewport), the branches it would have drawn
   * still have to be STATED — a frame that silently stops implies the family
   * ends there. The parent unit takes the whole upward count, and each child
   * takes their own descendants. */
  if (opts.includeReach === false) {
    if (focusParentAnchor) {
      const beyondIds = new Set();
      for (const mid of focusParentAnchor.anchorMemberIds) {
        for (const [aid, v] of ancestorsWithDistance(graph, mid, 8)) {
          if (v.distance > 0) beyondIds.add(aid);
        }
      }
      addHorizon(focusParentAnchor, 'up', beyondIds.size);
    }
    /* A childless child is still the end of its own line on a narrow frame;
     * one WITH children now draws them, and each of those carries its own
     * horizon in the shared pass above. */
    for (const cu of childUnits) {
      if (byParent.get(cu.memberIds[0])?.length) continue;
      let beyond = 0;
      for (const [, v] of descendantsWithDistance(graph, cu.memberIds[0], 6)) {
        if (v.distance > 0) beyond++;
      }
      addHorizon(cu, 'down', beyond);
    }
  }

  // Junction units do not render people of their own. Resolve their planned
  // x from the visible members only after every row has completed its
  // de-overlap pass, so junction ordering and camera composition reflect the
  // picture the user will actually see.
  for (const anchor of anchors.values()) {
    const xs = anchor.anchorMemberIds.map((id) => {
      const u = units.find((candidate) => !candidate.anchorOnly && candidate.memberIds.includes(id));
      return u ? u.x + (u.offsets.get(id) || 0) : null;
    }).filter(Number.isFinite);
    if (xs.length) anchor.x = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  }

  /* ── Junction levels ────────────────────────────────────────────────────
   * Two different couples whose children share a row each draw a stem, a
   * junction bar and a branch per child. Drawn at the same height, those two
   * bars butt together into one continuous line, and five children of two
   * different couples read as five siblings of one — a real misstatement of
   * the family, caught on the second render pass. Giving each parent unit
   * its own junction height separates them. Ordered by x so the assignment
   * is stable and deterministic, like every other ordering here.
   */
  const descentParents = [...new Set(bonds.filter((b) => b.kind === 'descent').map((b) => b.parentUnit))];
  const unitX = new Map(units.map((u) => [u.id, u.x]));
  descentParents.sort((a, b) => (unitX.get(a) ?? 0) - (unitX.get(b) ?? 0) || String(a).localeCompare(String(b)));
  const junctionLevel = new Map(descentParents.map((id, i) => [id, i % 3]));
  for (const b of bonds) {
    if (b.kind === 'descent') b.junctionLevel = junctionLevel.get(b.parentUnit) ?? 0;
  }

  /* ── Re-anchor on the focus ─────────────────────────────────────────────
   * The de-overlap passes above can legitimately shift any row — including
   * the focus row — to resolve a collision. That would break the guarantee
   * the whole selection contract rests on, so the entire frame is translated
   * by whatever the focus drifted. A rigid translation cannot disturb any
   * relative alignment established above (a parent centred over its children
   * stays centred), and it makes "the focus is at world origin" true by
   * construction rather than by hoping nothing pushed them. */
  const focusDrift = focusUnit.x + focusUnit.offsets.get(focusId);
  if (focusDrift !== 0) for (const u of units) u.x -= focusDrift;

  /* ── Resolve to node positions ──────────────────────────────────────── */
  const nodes = new Map();
  for (const u of units) {
    if (u.anchorOnly) continue;
    // The focus (and, since a pod is rigid, their current partner with them)
    // sits FOCUS_Y_DROP below the row-0 baseline everyone else measures from
    // — a fixed, deterministic constant, not data-dependent, so the camera's
    // own fixed-point re-pointing trick (see CanopyTree.jsx's setFocus) still
    // works exactly as before: it only ever needed the focus at a KNOWN,
    // unchanging point, which this still is — just not literally (0, 0).
    const rowBaselineY = u.row * rowGap + (u.rank || 0) * RANK_GAP + (u === focusUnit ? FOCUS_Y_DROP : 0);
    // What a descent anchor should average over when THIS unit is one of
    // several drawn parents: the arc dip is real (a sibling's own horizon
    // chip has to follow it — see unitAnchor's own note on this), but a
    // satellite's structural lift is not — that exclusion is the whole
    // point of rowBaselineY (see the Satellites note above). Arc dip is
    // never actually set on a row -1 parent unit in the first place (only
    // row 0 siblings wave), so this only ever differs from rowBaselineY on
    // exactly the unit it is meant to differ on.
    const anchorY = rowBaselineY + (u.arcDip || 0);
    for (const mid of u.memberIds) {
      nodes.set(mid, {
        id: mid,
        unitId: u.id,
        x: u.x + u.offsets.get(mid),
        // A satellite's OWN dot is lifted, and a sibling's own dot waves —
        // the row's BASELINE is neither. See anchorY below and
        // unitAnchor's use of it: a descent's start point must stay put
        // regardless of how the child at its far end happens to be drawn.
        y: rowBaselineY - (u.satelliteLift || 0) + (u.arcDip || 0),
        rowBaselineY,
        anchorY,
        row: u.row,
        rank: u.rank || 0,
        band: u.band,
        r: NODE_R * BAND_SCALE[u.band] * (mid === focusId ? FOCUS_SCALE : 1),
        labelHalfWidth: u.labelHalfWidths?.get(mid) || 0,
        isFocus: mid === focusId,
        satellite: !!u.satellite,
      });
    }
  }

  const xs = [...nodes.values()];
  const bounds = xs.length ? {
    minX: Math.min(...xs.map((n) => n.x - Math.max(n.r, n.labelHalfWidth || 0))),
    maxX: Math.max(...xs.map((n) => n.x + Math.max(n.r, n.labelHalfWidth || 0))),
    minY: Math.min(...xs.map((n) => n.y - n.r)),
    maxY: Math.max(...xs.map((n) => n.y + n.r)),
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const rows = new Map();
  for (const u of units) {
    if (u.anchorOnly) continue;
    if (!rows.has(u.row)) rows.set(u.row, []);
    rows.get(u.row).push(u);
  }

  return { focusId, nodes, units, bonds, horizons, rows, bounds };
}

/* Hang a reach-band group beneath `cx` as a compact cluster.
 *
 * Grows ACROSS first, then down, to MAX_CLUSTER_RANKS deep, then across
 * again — so a family of three is one tidy line and a family of nine is a
 * three-by-three bunch rather than a nine-wide stretch of row. Each rank is
 * centred on `cx` in its own right, including a partial last rank, so the
 * cluster reads as a bunch hanging from the branch rather than as a ragged
 * left-aligned grid. Order is preserved exactly: reading across then down is
 * still birth order, which is what the growth choreography staggers on.
 */
function clusterUnder(group, cx) {
  const k = group.length;
  if (!k) return;
  const cols = k <= 2 ? k : Math.max(2, Math.ceil(k / MAX_CLUSTER_RANKS));
  group.forEach((u, i) => {
    const rank = Math.floor(i / cols);
    const col = i % cols;
    const inRank = Math.min(cols, k - rank * cols);
    u.x = cx - ((inRank - 1) * REACH_GAP) / 2 + col * REACH_GAP;
    u.rank = rank;
  });
}

/* The union midpoint a descent ribbon starts from. Computed from the unit's
 * OWN offsets rather than assumed from its width, because the focus pod is
 * deliberately anchored on its first member (see makeUnit) while every other
 * pod is centred — so "u.x plus half the span" is right for one of them and
 * wrong for the other. */
export function unitAnchor(frame, unitId) {
  const u = frame.units.find((x) => x.id === unitId);
  if (!u) return null;
  const anchorIds = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
  const positions = anchorIds.map((id) => frame.nodes.get(id)).filter(Boolean);
  if (!positions.length) return null;
  const lo = Math.min(...positions.map((n) => n.x));
  const hi = Math.max(...positions.map((n) => n.x));
  // A satellite's structural LIFT is about where its own dot sits, not about
  // where a descent line should start — a child with one lifted parent must
  // still branch from the row's true baseline, or the trunk would visibly
  // originate from nowhere. anchorY excludes the satellite lift but keeps a
  // sibling's own peer-arc dip, so a sibling's horizon chip anchors at their
  // real dipped position rather than snapping back to an undipped baseline.
  const y = positions.reduce((sum, n) => sum + (n.anchorY ?? n.y), 0) / positions.length;
  return {
    x: (lo + hi) / 2,
    y,
    r: Math.max(...positions.map((n) => n.r)),
    // A pod's anchor is the empty midpoint between two people, so a descent
    // can leave from just under the capsule. A LONE parent's anchor is the
    // person themselves, and their name sits directly below — a descent
    // leaving at the same height draws a line straight through it.
    isPod: anchorIds.length > 1,
    band: u.band,
  };
}
