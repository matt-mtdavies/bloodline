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
 *   • a former partner is its own unit, bonded, and ordered outboard of the
 *     current pod — by rule, not by anything pushing on anything;
 *   • siblings share the focus row, in birth order across it;
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

import { sortSiblings, sortChildren, ancestorsWithDistance, descendantsWithDistance } from '../../data/graph.js';

/** Vertical distance between generation rows. */
/* Raised from 265 once the trunk was made to start below each person's NAME
 * rather than at the edge of their portrait (see render.js's trunkSpan): that
 * left under 100px for a branch to travel, which compressed the curves into
 * steep, cramped hooks. A branch needs room to read as a sweep. */
export const ROW_GAP = 310;
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

/** Fidelity bands. Size, saturation and opacity all fall off together with
 *  this, so one gradient does three jobs and reads as depth rather than as
 *  three separate effects. */
export const BAND = { HEARTH: 'hearth', KIN: 'kin', REACH: 'reach' };
/** Radius multiplier per band. */
export const BAND_SCALE = { hearth: 1, kin: 0.86, reach: 0.66 };

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
    labelHalfWidth(opts.byId?.get(mid), band, mid === opts.focusId),
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

function displayName(person) {
  const raw = (person?.display_name || 'Unknown').trim();
  const parts = raw.split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : raw;
}

function labelHalfWidth(person, band, isFocus = false) {
  const fontSize = isFocus ? 21 : band === BAND.REACH ? 13 : 15;
  // Pixi's Georgia metrics vary slightly by platform. This conservative
  // estimate deliberately errs toward air; the cap keeps one extreme name
  // from making an otherwise intimate family feel empty.
  return Math.min(154, Math.max(NODE_R * BAND_SCALE[band], displayName(person).length * fontSize * 0.31 + 8));
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
  const addUnion = (a, b) => {
    const edge = graph.partners(a).find((p) => p.id === b);
    if (!edge) return;
    const key = [a, b].sort().join('|');
    if (unionSeen.has(key)) return;
    unionSeen.add(key);
    bonds.push({ kind: 'union', a, b, status: isCurrent(edge.status) ? 'current' : 'former' });
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

  /* Former partners of the focus: their own units, bonded dashed, ordered
   * outboard by orderRow. */
  const focusFormer = partnersOf(focusId, false).filter(claim).sort(cmp);
  const formerUnits = focusFormer.map((pid) => {
    const u = newUnit(pid, [pid], BAND.KIN);
    u.row = 0;
    u.outboard = true;
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
      units.push(pu);
      coParentUnits.push(pu);
      addUnion(focusId, ref.id);
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
    for (const ref of refs) ensureParentPerson(ref.id);
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) addUnion(refs[i].id, refs[j].id);
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
    for (const pid of parentIds) {
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
  for (const cu of (opts.includeReach === false ? [] : childUnits)) {
    const cid = cu.memberIds[0];
    const gcRefs = sortChildren(graph.children(cid).filter((g) => byId.has(g.id)), byId);
    for (const gc of gcRefs) {
      if (!claim(gc.id)) continue;
      const gu = newUnit(gc.id, [gc.id], BAND.REACH);
      gu.row = 2;
      gu.parentId = cid;
      units.push(gu);
      grandChildUnits.push(gu);
      bonds.push({ kind: 'descent', parentUnit: cu.id, child: gc.id, qualifier: gc.qualifier || 'biological' });
    }
  }

  /* ── Placement ──────────────────────────────────────────────────────────
   * Each row is placed against the row it hangs from, then de-overlapped.
   * Order within a row is decided before any x is assigned, so de-overlap
   * can only ever widen gaps — it can never reorder anybody. */

  /* Row 0 — the focus, their partners, and their siblings.
   *
   * PAST TO THE LEFT, PRESENT TO THE RIGHT. Former partners and other
   * co-parents are placed on the opposite side of the focus from the current
   * pod, not outboard of it.
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
   * Siblings sit outside the partners on both sides, so the people the focus
   * actually formed families with stay nearest to them.
   */
  const focusRight = (focusUnit.memberIds.length - 1) * focusUnit.gap; // right edge of the focus pod
  const pastUnits = [...formerUnits, ...coParentUnits];
  pastUnits.forEach((u, i) => { u.x = -(i + 1) * UNIT_GAP; });

  const elder = [], younger = [];
  for (const u of sibUnits) (cmp(u.memberIds[0], focusId) < 0 ? elder : younger).push(u);
  elder.sort((a, b) => cmp(b.memberIds[0], a.memberIds[0])); // nearest-in-age first, going left
  younger.sort((a, b) => cmp(a.memberIds[0], b.memberIds[0]));
  elder.forEach((u, i) => { u.x = -(pastUnits.length + i + 1) * UNIT_GAP; });
  deOverlapRow([focusUnit, ...sibUnits, ...formerUnits, ...coParentUnits]);

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
  const blockWidth = (g) => {
    const n = g.units.length;
    if (!n) return 0;
    return (n - 1) * UNIT_GAP + halfOf(g.units[0], 'left') + halfOf(g.units[n - 1], 'right');
  };

  let prevRight = -Infinity;
  for (const g of blocks) {
    const w = blockWidth(g);
    let left = g.cx - w / 2;
    if (left < prevRight + BLOCK_GAP) left = prevRight + BLOCK_GAP;
    const start = left + halfOf(g.units[0], 'left');
    g.units.forEach((u, i) => { u.x = start + i * UNIT_GAP; });
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

  // Row +2: each grandchild group centred under its own parent.
  const byParent = new Map();
  for (const gu of grandChildUnits) {
    if (!byParent.has(gu.parentId)) byParent.set(gu.parentId, []);
    byParent.get(gu.parentId).push(gu);
  }
  for (const [pid, group] of byParent) {
    const pu = childUnits.find((u) => u.memberIds[0] === pid);
    centreUnder(group, pu ? pu.x : 0);
  }
  deOverlapRow(grandChildUnits);

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
    for (const cu of childUnits) {
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
    for (const mid of u.memberIds) {
      nodes.set(mid, {
        id: mid,
        unitId: u.id,
        x: u.x + u.offsets.get(mid),
        y: u.row * ROW_GAP,
        row: u.row,
        band: u.band,
        r: NODE_R * BAND_SCALE[u.band],
        labelHalfWidth: u.labelHalfWidths?.get(mid) || 0,
        isFocus: mid === focusId,
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

/** Spread a group of single-person units evenly, centred on `cx`. */
function centreUnder(group, cx) {
  if (!group.length) return;
  const span = (group.length - 1) * UNIT_GAP;
  group.forEach((u, i) => { u.x = cx - span / 2 + i * UNIT_GAP; });
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
  const y = positions.reduce((sum, n) => sum + n.y, 0) / positions.length;
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
