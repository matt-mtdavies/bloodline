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
export const ROW_GAP = 265;
/** Centre-to-centre spacing between two people inside one partner pod. */
export const POD_GAP = 150;
/** Minimum centre-to-centre spacing between adjacent units on one row. */
export const UNIT_GAP = 208;
/** Nominal person radius at full fidelity — spacing and hit-testing use this. */
export const NODE_R = 54;

/** Fidelity bands. Size, saturation and opacity all fall off together with
 *  this, so one gradient does three jobs and reads as depth rather than as
 *  three separate effects. */
export const BAND = { HEARTH: 'hearth', KIN: 'kin', REACH: 'reach' };
/** Radius multiplier per band. */
export const BAND_SCALE = { hearth: 1, kin: 0.86, reach: 0.66 };

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';
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
  const gap = POD_GAP * (0.55 + 0.45 * BAND_SCALE[band]);
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
    band,
    gap,
    row: 0,
    x: 0,
    anchorId: opts.anchorId || memberIds[0],
    kind: n > 1 ? 'pod' : 'single',
  };
}

/** Half-width of a unit in world units, for spacing and de-overlap. */
function unitHalfWidth(unit) {
  const r = NODE_R * BAND_SCALE[unit.band];
  const span = (unit.memberIds.length - 1) * unit.gap;
  return span / 2 + r;
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
    const need = unitHalfWidth(prev) + unitHalfWidth(cur) + (UNIT_GAP - NODE_R * 2);
    const have = cur.x - prev.x;
    if (have < need) {
      const push = (need - have) / 2;
      // Shift both halves of the row outward, so the row keeps its centre.
      for (let j = 0; j < i; j++) units[j].x -= push;
      for (let j = i; j < units.length; j++) units[j].x += push;
    }
  }
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
  const partnersOf = (id, current) =>
    graph.partners(id).filter((pt) => (current ? isCurrent(pt.status) : !isCurrent(pt.status)) && byId.has(pt.id)).map((pt) => pt.id);

  /* ROW 0 — the focus pod. The focus person is claimed first and anchors the
   * whole composition at world origin. */
  claim(focusId);
  const focusCurrent = partnersOf(focusId, true).filter(claim).sort(cmp);
  const focusUnit = makeUnit(focusId, [focusId, ...focusCurrent], BAND.HEARTH, { anchorFirst: true, anchorId: focusId });
  focusUnit.row = 0;
  focusUnit.x = 0;
  units.push(focusUnit);
  for (const pid of focusCurrent) bonds.push({ kind: 'union', a: focusId, b: pid, status: 'current' });

  /* Former partners of the focus: their own units, bonded dashed, ordered
   * outboard by orderRow. */
  const focusFormer = partnersOf(focusId, false).filter(claim).sort(cmp);
  const formerUnits = focusFormer.map((pid) => {
    const u = makeUnit(pid, [pid], BAND.KIN);
    u.row = 0;
    u.outboard = true;
    units.push(u);
    bonds.push({ kind: 'union', a: focusId, b: pid, status: 'former' });
    return u;
  });

  /* ROW +1 — children. Every child of the focus (by any partner), in the
   * app's own display order (tier, then age, then name). */
  const childRefs = sortChildren(graph.children(focusId).filter((c) => byId.has(c.id)), byId);
  const childUnits = [];
  for (const c of childRefs) {
    if (!claim(c.id)) continue;
    const u = makeUnit(c.id, [c.id], BAND.HEARTH);
    u.row = 1;
    u.qualifier = c.qualifier || 'biological';
    units.push(u);
    childUnits.push(u);
    // A child bonds to the union that produced them, so the ribbon starts at
    // the couple rather than at one member of it.
    bonds.push({ kind: 'descent', parentUnit: focusUnit.id, child: c.id, qualifier: u.qualifier });
  }

  /* ROW 0 — siblings, placed across the focus row in birth order. Putting
   * elder siblings to the left of the focus and younger to the right makes
   * the row itself read chronologically, which is a free piece of legibility
   * that a force layout can never offer. */
  const sibRefs = sortSiblings(graph.siblings(focusId).filter((s) => byId.has(s.id)), byId);
  const sibUnits = [];
  for (const s of sibRefs) {
    if (!claim(s.id)) continue;
    const u = makeUnit(s.id, [s.id], BAND.KIN);
    u.row = 0;
    u.kindOfSibling = s.kind;
    units.push(u);
    sibUnits.push(u);
  }

  /* ROW -1 — parents, as one pod when they are partnered with each other. */
  const parentRefs = graph.parents(focusId).filter((p) => byId.has(p.id));
  const parentIds = parentRefs.map((p) => p.id).sort(cmp);
  let parentUnit = null;
  if (parentIds.length) {
    const [a, b] = parentIds;
    const partnered = b && graph.partners(a).some((pt) => pt.id === b);
    const members = partnered ? [a, b] : [a];
    members.forEach(claim);
    parentUnit = makeUnit(a, members, BAND.KIN);
    parentUnit.row = -1;
    units.push(parentUnit);
    if (partnered) bonds.push({ kind: 'union', a, b, status: 'current' });
    // The focus and every drawn sibling descend from this unit.
    bonds.push({ kind: 'descent', parentUnit: parentUnit.id, child: focusId, qualifier: parentRefs.find((p) => p.id === a)?.qualifier || 'biological' });
    for (const u of sibUnits) bonds.push({ kind: 'descent', parentUnit: parentUnit.id, child: u.memberIds[0], qualifier: 'biological' });
    // A second parent who is NOT partnered with the first still belongs on
    // the row — drawn as their own unit rather than forced into a pod that
    // misrepresents the relationship.
    if (b && !partnered && claim(b)) {
      const u2 = makeUnit(b, [b], BAND.KIN);
      u2.row = -1;
      units.push(u2);
      bonds.push({ kind: 'descent', parentUnit: u2.id, child: focusId, qualifier: parentRefs.find((p) => p.id === b)?.qualifier || 'biological' });
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
  if (parentUnit && opts.includeReach !== false) {
    for (const pid of parentUnit.memberIds) {
      const gRefs = graph.parents(pid).filter((g) => byId.has(g.id));
      const gIds = gRefs.map((g) => g.id).sort(cmp);
      if (!gIds.length) continue;
      const [ga, gb] = gIds;
      const partnered = gb && graph.partners(ga).some((pt) => pt.id === gb);
      const members = (partnered ? [ga, gb] : [ga]).filter(claim);
      if (!members.length) continue;
      const gu = makeUnit(members[0], members, BAND.REACH);
      gu.row = -2;
      gu.childId = pid; // centred over the parent they produced
      units.push(gu);
      grandUnits.push(gu);
      if (members.length > 1) bonds.push({ kind: 'union', a: members[0], b: members[1], status: 'current' });
      bonds.push({ kind: 'descent', parentUnit: gu.id, child: pid, qualifier: 'biological' });
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
      const gu = makeUnit(gc.id, [gc.id], BAND.REACH);
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

  // Row 0: focus at origin; siblings spread outward in birth order, elder
  // to the left. Former partners sit outboard of everything.
  const focusRight = (focusUnit.memberIds.length - 1) * focusUnit.gap; // right edge of the focus pod
  const elder = [], younger = [];
  for (const u of sibUnits) (cmp(u.memberIds[0], focusId) < 0 ? elder : younger).push(u);
  elder.sort((a, b) => cmp(b.memberIds[0], a.memberIds[0])); // nearest-in-age first, going left
  younger.sort((a, b) => cmp(a.memberIds[0], b.memberIds[0]));
  elder.forEach((u, i) => { u.x = -(i + 1) * UNIT_GAP; });
  // A former partner sits immediately OUTBOARD of the current pod — past the
  // last current partner, before the siblings. Two things fall out of that:
  // they can never land between the focus and a current partner (the actual
  // reported bug), and the bond to them stays SHORT. An earlier pass put
  // them beyond the outermost sibling instead, which satisfied the same
  // constraint but drew a dissolved-marriage line clean across two unrelated
  // people — technically correct, visually nonsense.
  formerUnits.forEach((u, i) => { u.x = focusRight + (i + 1) * UNIT_GAP; });
  younger.forEach((u, i) => { u.x = focusRight + (formerUnits.length + i + 1) * UNIT_GAP; });
  deOverlapRow([focusUnit, ...sibUnits, ...formerUnits]);

  // Row +1: children centred under the focus POD's midpoint (not under the
  // focus person alone — a child descends from the union).
  const podMid = focusUnit.x + focusRight / 2;
  centreUnder(childUnits, podMid);
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
  if (parentUnit) {
    const lo = Math.min(...row1Units.map((u) => u.x));
    const hi = Math.max(...row1Units.map((u) => u.x + (u.memberIds.length - 1) * u.gap));
    parentUnit.x = (lo + hi) / 2;
  }
  deOverlapRow(units.filter((u) => u.row === -1));

  // Row -2: each grandparent pod centred over the parent it produced.
  for (const gu of grandUnits) {
    const target = parentUnit && parentUnit.offsets.has(gu.childId)
      ? parentUnit.x + parentUnit.offsets.get(gu.childId)
      : (parentUnit ? parentUnit.x : 0);
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
    if (parentUnit) {
      const beyondIds = new Set();
      for (const mid of parentUnit.memberIds) {
        for (const [aid, v] of ancestorsWithDistance(graph, mid, 8)) {
          if (v.distance > 0) beyondIds.add(aid);
        }
      }
      addHorizon(parentUnit, 'up', beyondIds.size);
    }
    for (const cu of childUnits) {
      let beyond = 0;
      for (const [, v] of descendantsWithDistance(graph, cu.memberIds[0], 6)) {
        if (v.distance > 0) beyond++;
      }
      addHorizon(cu, 'down', beyond);
    }
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
    for (const mid of u.memberIds) {
      nodes.set(mid, {
        id: mid,
        unitId: u.id,
        x: u.x + u.offsets.get(mid),
        y: u.row * ROW_GAP,
        row: u.row,
        band: u.band,
        r: NODE_R * BAND_SCALE[u.band],
        isFocus: mid === focusId,
      });
    }
  }

  const xs = [...nodes.values()];
  const bounds = xs.length ? {
    minX: Math.min(...xs.map((n) => n.x - n.r)),
    maxX: Math.max(...xs.map((n) => n.x + n.r)),
    minY: Math.min(...xs.map((n) => n.y - n.r)),
    maxY: Math.max(...xs.map((n) => n.y + n.r)),
  } : { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const rows = new Map();
  for (const u of units) {
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
  const offs = u.memberIds.map((m) => u.offsets.get(m));
  const mid = (Math.min(...offs) + Math.max(...offs)) / 2;
  return {
    x: u.x + mid,
    y: u.row * ROW_GAP,
    r: NODE_R * BAND_SCALE[u.band],
    // A pod's anchor is the empty midpoint between two people, so a descent
    // can leave from just under the capsule. A LONE parent's anchor is the
    // person themselves, and their name sits directly below — a descent
    // leaving at the same height draws a line straight through it.
    isPod: u.memberIds.length > 1,
    band: u.band,
  };
}
