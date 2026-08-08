/*
 * V2 layout planner — active-person-centric, deterministic, pure.
 *
 * The conceptual correction this exists to make: "organic" is a quality of
 * MOTION, not a layout algorithm. V1 let global forces decide where everybody
 * ended up, which means the composition was an emergent side effect of charge,
 * collision and link distances all negotiating at once — and a distant branch
 * could drag the family you were actually looking at out of frame.
 *
 * Here the composition is DECIDED, once, by rules, and the springs (springs.js)
 * are what make arriving at it feel alive. This module never sees a velocity,
 * a frame or a canvas: it takes the graph, who is selected, and how big the
 * viewport is, and returns where everything belongs.
 *
 *   planFamilyLayout({ graph, activeId, visibleIds, viewport, anchor })
 *     → { positions, units, unitOf, rows, camera, nearIds, bounds }
 *
 * Guarantees the tests pin (tests/treeLayoutV2.test.mjs):
 *   • the active person is always at world origin (0, 0);
 *   • partners and former partners share the active person's row;
 *   • a parent's row is strictly above every one of their children's;
 *   • siblings share one row;
 *   • children are centred beneath their own parent union and evenly spread;
 *   • a partner pod is rigid — member offsets depend only on the pod;
 *   • the near family's positions do not depend on distant relatives at all;
 *   • same input → byte-identical output (no Math.random, all sorts total).
 */

/** Vertical distance between generation rows. */
export const ROW_GAP = 250;
/** Centre-to-centre spacing between two people inside one partner pod. */
export const POD_GAP = 150;
/** Minimum centre-to-centre spacing between adjacent units on the same row. */
export const UNIT_GAP = 210;
/** Half-width of a person for spacing purposes (bubble radius + breathing room). */
export const NODE_RADIUS = 62;
/** Minimum EDGE-TO-EDGE clearance the row de-overlap pass enforces between
 *  two independently-placed groups sharing a row (e.g. two different sets
 *  of children under two different couples). */
export const ROW_GROUP_GAP = 40;

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';

/* Total ordering helpers — every sort in this file ends in an id comparison so
 * that two people with identical data can never swap places between runs. */
const byBirthThenId = (byId) => (a, b) => {
  const pa = byId.get(a), pb = byId.get(b);
  const ba = pa?.birth_date ?? null, bb = pb?.birth_date ?? null;
  if (ba && bb && ba !== bb) return ba < bb ? -1 : 1;
  if (ba && !bb) return -1;
  if (!ba && bb) return 1;
  return String(a).localeCompare(String(b));
};

/* ── Partner pods ─────────────────────────────────────────────────────────
 * A pod is a hub plus their DIRECT partners only (any status — a former
 * partner is still a co-parent and still belongs on the couple's row).
 * Deliberately NOT the full transitive closure of the partner graph: a real
 * bug had A–B, B–C, C–D collapse into one giant rigid pod just because B
 * happens to have two partners and C happens to have two partners — B's
 * partnership with C has nothing to do with A, and belongs in its own unit.
 * A pod is the unit of layout: it is placed as one rigid object and moves as
 * one, so only genuinely DIRECT partnerships should share that rigidity.
 */
function buildUnits(graph, visible, activeId) {
  const claimed = new Set();
  const units = [];
  const unitOf = new Map();
  const partnersOf = (id) => graph.partners(id).filter((pt) => visible.has(pt.id)).map((pt) => pt.id);

  const makeUnit = (hub, memberIds) => {
    const ids = [...new Set(memberIds)].sort((a, b) => String(a).localeCompare(String(b)));
    for (const id of ids) claimed.add(id);
    const unit = { id: `u:${ids[0]}`, memberIds: ids, offsets: new Map(), row: 0, x: 0, anchorId: hub };
    if (ids.length === 1) {
      unit.offsets.set(ids[0], 0);
    } else {
      const statusOf = new Map(graph.partners(hub).map((pt) => [pt.id, pt.status]));
      const others = ids.filter((id) => id !== hub).sort(byBirthThenId(graph.byId));
      // Former partners to the left of the anchor, current to the right —
      // a remarried person sits between the two chapters of their life.
      const left = others.filter((id) => statusOf.get(id) === 'former');
      const right = others.filter((id) => statusOf.get(id) !== 'former');
      unit.offsets.set(hub, 0);
      left.forEach((id, i) => unit.offsets.set(id, -(i + 1) * POD_GAP));
      right.forEach((id, i) => unit.offsets.set(id, (i + 1) * POD_GAP));
    }
    // Pod width, used when packing units along a row.
    const offs = [...unit.offsets.values()];
    unit.left = Math.min(...offs) - NODE_RADIUS;
    unit.right = Math.max(...offs) + NODE_RADIUS;
    unit.width = unit.right - unit.left;
    units.push(unit);
    for (const id of ids) unitOf.set(id, unit);
  };

  // 1. The active person's own pod forms first, centred on THEM — this is
  //    what lets the camera hold them still no matter how many partners of
  //    partners exist elsewhere in the graph.
  if (visible.has(activeId) && !claimed.has(activeId)) {
    makeUnit(activeId, [activeId, ...partnersOf(activeId).filter((id) => !claimed.has(id))]);
  }

  // 2. Everyone else: direct-partnership stars only, processed most-partnered
  //    first so a genuine hub claims its partners before a single-partner
  //    "leaf" on the same chain can steal one away first. Ties break on id
  //    for determinism, independent of insertion order.
  const remaining = [...visible].filter((id) => !claimed.has(id))
    .sort((a, b) => (partnersOf(b).length - partnersOf(a).length) || String(a).localeCompare(String(b)));
  for (const id of remaining) {
    if (claimed.has(id)) continue; // already swept in as someone else's partner
    makeUnit(id, [id, ...partnersOf(id).filter((pid) => !claimed.has(pid))]);
  }

  units.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { units, unitOf };
}

/* ── Rows ─────────────────────────────────────────────────────────────────
 * Generation relative to the active person: 0 is their row, -1 their parents,
 * +1 their children. Derived by BFS out from the active person so the rows are
 * about THEM, not about some global root — then unified per pod (a pod shares
 * one row) and finally made monotone so a parent is never level with or below
 * their own child.
 */
function assignRows(graph, visible, activeId, units, unitOf) {
  const row = new Map([[activeId, 0]]);
  const queue = [activeId];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const r = row.get(id);
    const step = (nextId, delta) => {
      if (!visible.has(nextId) || row.has(nextId)) return;
      row.set(nextId, r + delta);
      queue.push(nextId);
    };
    // Deterministic neighbour order: parents, then children, then partners,
    // each sorted, so BFS discovery order never depends on insertion order.
    for (const q of [...graph.parents(id)].sort(byBirthThenId(graph.byId))) step(q.id, -1);
    for (const q of [...graph.children(id)].sort(byBirthThenId(graph.byId))) step(q.id, +1);
    for (const q of [...graph.partners(id)].sort(byBirthThenId(graph.byId))) step(q.id, 0);
  }
  // Anyone unreachable (a disconnected household) is parked below everything.
  let parked = 0;
  for (const id of [...visible].sort()) {
    if (!row.has(id)) { row.set(id, 0); parked++; }
  }

  // One row per pod: the deepest member wins, so a married-in partner joins
  // their spouse's row rather than floating at their own ancestral depth.
  for (const unit of units) {
    const rows = unit.memberIds.map((id) => row.get(id) ?? 0);
    const level = unit.memberIds.includes(activeId) ? 0 : Math.max(...rows);
    for (const id of unit.memberIds) row.set(id, level);
  }

  // Monotone repair: a child sits at least one row below every visible parent.
  // Rows only ever move DOWN, so this always terminates.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const id of visible) {
      const parents = graph.parents(id).filter((q) => visible.has(q.id) && isBioAdopt(q.qualifier));
      if (!parents.length) continue;
      const need = Math.max(...parents.map((q) => row.get(q.id) ?? 0)) + 1;
      if ((row.get(id) ?? 0) < need) {
        // Move the whole pod so the couple stays level.
        const unit = unitOf.get(id);
        const delta = need - (row.get(id) ?? 0);
        for (const m of unit.memberIds) row.set(m, (row.get(m) ?? 0) + delta);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const unit of units) unit.row = row.get(unit.memberIds[0]) ?? 0;
  return { row, parked };
}

/* ── The near family ──────────────────────────────────────────────────────
 * Everyone whose position is DECIDED by the composition rules rather than
 * packed into leftover space: the active pod, their parents and grandparents,
 * their siblings, their children and grandchildren, and their nieces and
 * nephews — plus the partners of all of those, since a pod is indivisible.
 *
 * Computed from EVERY member of the active pod, not just the active person —
 * a real report: a partner's own parents and children (Christopher's parents,
 * Ken's children in the "remarried" fixture) were being pushed off the near
 * family's span entirely, even in the fixture built specifically to show
 * them. "Near" has to be defined pod-wide and symmetrically, not from one
 * person's own ancestry/descent alone.
 */
function collectNear(graph, visible, activeId, unitOf) {
  const near = new Set();
  const add = (id) => {
    if (!visible.has(id) || near.has(id)) return;
    for (const m of unitOf.get(id)?.memberIds ?? [id]) near.add(m);
  };
  add(activeId);
  const podMembers = unitOf.get(activeId)?.memberIds ?? [activeId];

  const parentIds = new Set();
  for (const pm of podMembers) {
    add(pm);
    for (const q of graph.parents(pm)) if (visible.has(q.id)) { add(q.id); parentIds.add(q.id); }
    for (const s of graph.siblings?.(pm) ?? []) add(s.id);
  }
  for (const pid of parentIds) {
    graph.parents(pid).forEach((q) => add(q.id));   // grandparents
    graph.children(pid).forEach((q) => add(q.id));  // siblings, via a shared parent
  }

  const kidIds = new Set();
  for (const pm of podMembers) {
    for (const q of graph.children(pm)) if (visible.has(q.id)) { add(q.id); kidIds.add(q.id); }
  }
  for (const kid of kidIds) graph.children(kid).forEach((q) => add(q.id)); // grandchildren

  // Nieces and nephews: children of near people whose own parents overlap any
  // pod member's parents.
  for (const id of [...near]) {
    if (podMembers.includes(id)) continue;
    const isNieceNephew = graph.parents(id).some((q) => parentIds.has(q.id));
    if (isNieceNephew) graph.children(id).forEach((q) => add(q.id));
  }
  return near;
}

/* Packs a list of units along one row, centred on `centreX`, in the given
 * order, never closer than UNIT_GAP edge-to-edge. Returns each unit's centre. */
function packRow(unitList, centreX) {
  const widths = unitList.map((u) => Math.max(u.width, UNIT_GAP));
  const total = widths.reduce((s, w) => s + w, 0);
  let cursor = centreX - total / 2;
  const out = new Map();
  unitList.forEach((u, i) => {
    out.set(u.id, cursor + widths[i] / 2 - (u.left + u.right) / 2);
    cursor += widths[i];
  });
  return out;
}

/*
 * Places every distinct, not-yet-placed unit among `parentIds`' own units,
 * packed side by side around `centreX` — the shared machinery behind BOTH
 * "place someone's parents" and "place someone's grandparents", called once
 * per generation. Two co-parents who were never partnered (no partner edge
 * between them — a real, legitimate shape) are each their own separate unit;
 * this packs EVERY distinct one, rather than only the first one winning and
 * the rest scattering into "everyone else" (a real reported gap — this used
 * to happen to the remarried fixture's grandparents, Dorothy and Francis,
 * who are Christopher's parents but were never partnered in the data). The
 * common case — one real couple, or a single parent — is just one unit.
 */
/** A person's own resolved x — their unit's placed centre plus their offset
 *  within it. Only meaningful once that unit has actually been placed. */
function resolvedX(unitOf, placed, id) {
  const u = unitOf.get(id);
  return (placed.get(u?.id) ?? 0) + (u?.offsets.get(id) ?? 0);
}

/** Orders a list of already-placed people left-to-right by their resolved x
 *  (ties broken by id, for determinism). Used to hand placeCoParents a
 *  grandparent/great-grandparent id list in the SAME left-to-right order as
 *  the row below it actually resolved to — see placeCoParents' own comment
 *  for the crossing-lines bug this exists to prevent. */
function orderByResolvedX(ids, unitOf, placed) {
  return [...ids].sort((a, b) => resolvedX(unitOf, placed, a) - resolvedX(unitOf, placed, b)
    || String(a).localeCompare(String(b)));
}

function placeCoParents(unitOf, placed, parentIds, centreX) {
  const units = [];
  const seen = new Set();
  for (const pid of parentIds) {
    const u = unitOf.get(pid);
    if (u && !seen.has(u.id)) { seen.add(u.id); units.push(u); }
  }
  // Deliberately NOT re-sorted by unit id. `units` is already in whatever
  // order `parentIds` was handed to us in, and every call site below now
  // constructs that order deliberately (birth order, or — for grandparents/
  // great-grandparents — sorted by the row below's own already-resolved x).
  // An earlier version re-sorted alphabetically by each unit's own id here,
  // which silently discarded that order: a real reported bug had a
  // grandparent group land on the OPPOSITE side from the actual child it
  // belongs to (decided independently, in buildUnits, by hub-selection and
  // former/current partner status), producing a crossing "X" of lines
  // between two adjacent rows purely because one grandparent-pair's id
  // happened to sort earlier than the other's.
  const unplaced = units.filter((u) => !placed.has(u.id));
  if (!unplaced.length) return;
  const packed = packRow(unplaced, centreX);
  for (const u of unplaced) placed.set(u.id, packed.get(u.id));
}

export function planFamilyLayout({
  graph,
  activeId,
  visibleIds,
  viewport = { width: 1200, height: 800 },
  anchor = null,
  minZoom = 0.35,
  maxZoom = 1.35,
}) {
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds ?? graph.people.map((q) => q.id));
  if (!visible.has(activeId)) visible.add(activeId);

  const { units, unitOf } = buildUnits(graph, visible, activeId);
  const { row } = assignRows(graph, visible, activeId, units, unitOf);
  const near = collectNear(graph, visible, activeId, unitOf);

  const activeUnit = unitOf.get(activeId);
  const placed = new Map(); // unitId → centre x

  /* 1. The active pod anchors the whole composition at x = 0. Its offsets are
   *    already centred on the active person, so the active person lands on the
   *    origin exactly — which is what lets the camera hold them still. */
  placed.set(activeUnit.id, 0);

  /* 2. The sibling rank. The active person keeps their birth-order slot, and
   *    the whole rank is then shifted so THEIR slot centre is x = 0. */
  // Sorted by birth-then-id (not raw graph order) so this list — now used
  // directly to decide placeCoParents' left-to-right order, see that
  // function's own comment — is deterministic independent of relationship
  // insertion order, not just independent of which two co-parents happen to
  // be genuinely partnered (that case was already covered by buildUnits'
  // own equally-deterministic hub selection).
  const parentIds = graph.parents(activeId).filter((q) => visible.has(q.id) && isBioAdopt(q.qualifier))
    .map((q) => q.id).sort(byBirthThenId(graph.byId));
  const sibUnits = [];
  if (parentIds.length) {
    const sibs = new Set([activeId]);
    for (const pid of parentIds) {
      for (const c of graph.children(pid)) if (visible.has(c.id)) sibs.add(c.id);
    }
    const ordered = [...sibs].sort(byBirthThenId(graph.byId));
    const seenUnits = new Set();
    for (const id of ordered) {
      const u = unitOf.get(id);
      if (u && !seenUnits.has(u.id)) { seenUnits.add(u.id); sibUnits.push(u); }
    }
    const packedRaw = packRow(sibUnits, 0);
    const shift = -(packedRaw.get(activeUnit.id) ?? 0);
    for (const u of sibUnits) placed.set(u.id, packedRaw.get(u.id) + shift);
  }

  /* 3. The parents' pod(s), centred over the sibling rank they produced —
   *    see placeCoParents' own comment for why this can be more than one
   *    unit. */
  if (parentIds.length) {
    const span = sibUnits.length ? sibUnits.map((u) => placed.get(u.id)) : [0];
    placeCoParents(unitOf, placed, parentIds, (Math.min(...span) + Math.max(...span)) / 2);

    /* 4. Grandparents: every distinct unit among ALL parents' own parents,
     *    centred over wherever the (now-placed) parent units ended up.
     *    `parentIds` is walked in its already-RESOLVED x order (not raw
     *    graph order) so a grandparent group lands on the same side as the
     *    parent it belongs to actually ended up on — see placeCoParents'
     *    own comment for the crossing-lines bug this prevents. */
    const gpIds = [];
    for (const pid of orderByResolvedX(parentIds, unitOf, placed)) {
      for (const q of [...graph.parents(pid)].sort(byBirthThenId(graph.byId))) if (visible.has(q.id)) gpIds.push(q.id);
    }
    if (gpIds.length) {
      const parentXs = parentIds.map((pid) => resolvedX(unitOf, placed, pid));
      placeCoParents(unitOf, placed, gpIds, (Math.min(...parentXs) + Math.max(...parentXs)) / 2);
    }
  }

  /* 3b. The SAME treatment for every OTHER member of the active pod's own
   *     parents/grandparents — e.g. Christopher's parents in the "remarried"
   *     fixture. A partner's own lineage is exactly the contextual family
   *     the near-family fix above already includes; without this it was
   *     included but never actually PLACED, so it fell through to "everyone
   *     else" and could land anywhere. Centred directly over that pod
   *     member's own x position (not the sibling rank, which is specific to
   *     the active person's own siblings). */
  for (const podMemberId of activeUnit.memberIds) {
    if (podMemberId === activeId) continue; // the active person's own line is step 3/4 above
    // Same determinism reasoning as `parentIds` above.
    const ppIds = graph.parents(podMemberId).filter((q) => visible.has(q.id) && isBioAdopt(q.qualifier))
      .map((q) => q.id).sort(byBirthThenId(graph.byId));
    if (!ppIds.length) continue;
    const memberX = (placed.get(activeUnit.id) ?? 0) + (activeUnit.offsets.get(podMemberId) ?? 0);
    placeCoParents(unitOf, placed, ppIds, memberX);

    const ggIds = [];
    for (const pid of orderByResolvedX(ppIds, unitOf, placed)) {
      for (const q of [...graph.parents(pid)].sort(byBirthThenId(graph.byId))) if (visible.has(q.id)) ggIds.push(q.id);
    }
    if (ggIds.length) {
      const ppXs = ppIds.map((pid) => resolvedX(unitOf, placed, pid));
      placeCoParents(unitOf, placed, ggIds, (Math.min(...ppXs) + Math.max(...ppXs)) / 2);
    }
  }

  /* 5. Children, grouped by their own parent union so a blended family's two
   *    child sets each hang under the right couple, then evenly spread. */
  const childGroups = new Map();
  for (const id of near) {
    const ps = graph.parents(id).filter((q) => visible.has(q.id)).map((q) => q.id).sort();
    if (!ps.length) continue;
    const key = ps.join('|');
    if (!childGroups.has(key)) childGroups.set(key, { parents: ps, kids: [] });
    childGroups.get(key).kids.push(id);
  }
  const groupsByRow = [...childGroups.values()]
    .filter((g) => g.parents.every((pid) => placed.has(unitOf.get(pid)?.id)))
    .sort((a, b) => a.parents.join('|').localeCompare(b.parents.join('|')));
  for (const grp of groupsByRow) {
    const parentCentres = grp.parents.map((pid) => {
      const u = unitOf.get(pid);
      return (placed.get(u.id) ?? 0) + (u.offsets.get(pid) ?? 0);
    });
    const midX = parentCentres.reduce((s, v) => s + v, 0) / parentCentres.length;
    const ordered = grp.kids.slice().sort(byBirthThenId(graph.byId));
    const kidUnits = [];
    const seenUnits = new Set();
    for (const id of ordered) {
      const u = unitOf.get(id);
      if (u && !seenUnits.has(u.id) && !placed.has(u.id)) { seenUnits.add(u.id); kidUnits.push(u); }
    }
    if (!kidUnits.length) continue;
    const packedKids = packRow(kidUnits, midX);
    for (const u of kidUnits) placed.set(u.id, packedKids.get(u.id));
  }

  /* 6. Anything left in the near set (grandchildren, nieces and nephews whose
   *    parents were themselves only just placed) — one more settling pass. */
  for (let pass = 0; pass < 3; pass++) {
    for (const grp of [...childGroups.values()].sort((a, b) => a.parents.join('|').localeCompare(b.parents.join('|')))) {
      if (!grp.parents.every((pid) => placed.has(unitOf.get(pid)?.id))) continue;
      const pending = grp.kids
        .slice().sort(byBirthThenId(graph.byId))
        .map((id) => unitOf.get(id)).filter((u) => u && !placed.has(u.id));
      const uniq = [];
      const seenUnits = new Set();
      for (const u of pending) if (!seenUnits.has(u.id)) { seenUnits.add(u.id); uniq.push(u); }
      if (!uniq.length) continue;
      const centres = grp.parents.map((pid) => (placed.get(unitOf.get(pid).id) ?? 0) + (unitOf.get(pid).offsets.get(pid) ?? 0));
      const midX = centres.reduce((s, v) => s + v, 0) / centres.length;
      const packedKids = packRow(uniq, midX);
      for (const u of uniq) placed.set(u.id, packedKids.get(u.id));
    }
  }

  /* 6b. Residual row de-overlap. Two DIFFERENT child groups on the same row
   *     (e.g. a blended family's two separate sets of kids, each centred
   *     under its own parents) are packed independently by step 5/6, with
   *     nothing checking whether the two independently-chosen centres leave
   *     enough room between the GROUPS themselves — a real gap: two
   *     children from different groups could end up closer than a single
   *     bubble's own diameter even though each group is internally spaced
   *     correctly. One left-to-right sweep per row, radiating out from
   *     whichever unit is fixed (the active unit, if this is its row, else
   *     whichever placed unit is already closest to the composition's own
   *     centre), enforces at least the same minimum spacing `packRow`
   *     itself already guarantees within one group — but across all of
   *     them — without moving anyone who was already comfortably spaced. */
  const byRow = new Map();
  for (const unit of units) {
    if (!placed.has(unit.id)) continue;
    if (!byRow.has(unit.row)) byRow.set(unit.row, []);
    byRow.get(unit.row).push(unit);
  }
  for (const rowUnits of byRow.values()) {
    if (rowUnits.length < 2) continue;
    rowUnits.sort((a, b) => placed.get(a.id) - placed.get(b.id));
    let anchorIdx = rowUnits.findIndex((u) => u.id === activeUnit.id);
    if (anchorIdx < 0) {
      anchorIdx = 0;
      for (let i = 1; i < rowUnits.length; i++) {
        if (Math.abs(placed.get(rowUnits[i].id)) < Math.abs(placed.get(rowUnits[anchorIdx].id))) anchorIdx = i;
      }
    }
    // Measured via each unit's REAL edges (placed anchor + its own left/right
    // extent), not an assumed symmetric half-width — a pod's anchor is not
    // necessarily at its own bounding-box centre (e.g. a former partner
    // hangs entirely to one side), so a symmetric estimate under-spaced
    // exactly the asymmetric pods this pass exists to fix.
    for (let i = anchorIdx + 1; i < rowUnits.length; i++) {
      const prev = rowUnits[i - 1], cur = rowUnits[i];
      const need = placed.get(prev.id) + prev.right + ROW_GROUP_GAP - cur.left;
      if (placed.get(cur.id) < need) placed.set(cur.id, need);
    }
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const next = rowUnits[i + 1], cur = rowUnits[i];
      const need = placed.get(next.id) + next.left - ROW_GROUP_GAP - cur.right;
      if (placed.get(cur.id) > need) placed.set(cur.id, need);
    }
  }

  /* 7. Everyone else. Packed per row into the space OUTSIDE the near family's
   *    span, alternating sides. This is the composition guard: the near family
   *    was placed above without ever consulting these people, so adding or
   *    removing a distant branch cannot move it. */
  const nearUnits = units.filter((u) => u.memberIds.some((id) => near.has(id)) && placed.has(u.id));
  const nearSpan = nearUnits.length
    ? {
      min: Math.min(...nearUnits.map((u) => placed.get(u.id) + u.left)),
      max: Math.max(...nearUnits.map((u) => placed.get(u.id) + u.right)),
    }
    : { min: 0, max: 0 };

  const rest = units.filter((u) => !placed.has(u.id));
  const perRow = new Map();
  for (const u of rest) {
    if (!perRow.has(u.row)) perRow.set(u.row, []);
    perRow.get(u.row).push(u);
  }
  for (const [, list] of [...perRow.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    let leftCursor = nearSpan.min - UNIT_GAP;
    let rightCursor = nearSpan.max + UNIT_GAP;
    list.forEach((u, i) => {
      const w = Math.max(u.width, UNIT_GAP);
      if (i % 2 === 0) {
        placed.set(u.id, rightCursor + w / 2 - (u.left + u.right) / 2);
        rightCursor += w;
      } else {
        placed.set(u.id, leftCursor - w / 2 - (u.left + u.right) / 2);
        leftCursor -= w;
      }
    });
  }

  /* ── Materialise positions ─────────────────────────────────────────────── */
  const positions = new Map();
  for (const unit of units) {
    const ux = placed.get(unit.id) ?? 0;
    unit.x = ux;
    for (const id of unit.memberIds) {
      positions.set(id, { x: ux + (unit.offsets.get(id) ?? 0), y: (row.get(id) ?? 0) * ROW_GAP });
    }
  }
  // Normalise so the active person is exactly the origin, whatever rounding
  // the packing produced. Every downstream guarantee leans on this.
  const a = positions.get(activeId) ?? { x: 0, y: 0 };
  if (a.x !== 0 || a.y !== 0) {
    for (const [id, pt] of positions) positions.set(id, { x: pt.x - a.x, y: pt.y - a.y });
    for (const unit of units) unit.x -= a.x;
  }

  /* ── Camera ───────────────────────────────────────────────────────────────
   * ONE destination, computed here, animated toward once — never recomputed
   * from live bounds while things are moving. Zoom frames the NEAR family, so
   * a huge distant branch can't shrink the family you're actually reading.
   *
   * The camera's world anchor is the origin — i.e. the active person — and its
   * screen anchor is `anchor`. Because both are fixed for the whole transition
   * and the active person IS the origin, their screen position is invariant
   * under zoom: screen = anchor + (world − origin) × zoom = anchor. That
   * identity is what "the selected person must remain fixed in screen
   * coordinates" reduces to, and it holds exactly rather than approximately.
   */
  const framed = nearUnits.length ? [...near] : [...visible];
  const pts = framed.map((id) => positions.get(id)).filter(Boolean);
  const bounds = pts.length
    ? {
      minX: Math.min(...pts.map((q) => q.x)) - NODE_RADIUS,
      maxX: Math.max(...pts.map((q) => q.x)) + NODE_RADIUS,
      minY: Math.min(...pts.map((q) => q.y)) - NODE_RADIUS,
      maxY: Math.max(...pts.map((q) => q.y)) + NODE_RADIUS,
    }
    : { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  const padX = viewport.width * 0.12;
  const padY = viewport.height * 0.16;
  const fitW = Math.max(1, bounds.maxX - bounds.minX);
  const fitH = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.max(minZoom, Math.min(maxZoom,
    Math.min((viewport.width - padX * 2) / fitW, (viewport.height - padY * 2) / fitH)));

  // Default screen anchor: the composition's own centre of mass expressed as a
  // screen point, so the near family sits centred when nothing else is asked
  // for. A caller mid-interaction passes the clicked point instead and the
  // person under the finger simply does not move.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const screenAnchor = anchor ?? {
    x: viewport.width / 2 - cx * zoom,
    y: viewport.height / 2 - cy * zoom,
  };

  return {
    activeId,
    positions,
    units,
    unitOf,
    rows: row,
    nearIds: near,
    bounds,
    camera: { worldX: 0, worldY: 0, screenX: screenAnchor.x, screenY: screenAnchor.y, zoom },
  };
}

/** Screen position of a world point under a camera. Shared by engine + tests. */
export function toScreen(camera, world) {
  return {
    x: camera.screenX + (world.x - camera.worldX) * camera.zoom,
    y: camera.screenY + (world.y - camera.worldY) * camera.zoom,
  };
}
