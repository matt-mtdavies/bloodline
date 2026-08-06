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
 * A pod is a partner-connected component (any status — a former partner is
 * still a co-parent and still belongs on the couple's row). Pods are the
 * unit of layout: they are placed as one rigid object and they move as one.
 */
function buildUnits(graph, visible, activeId) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const id of visible) if (!parent.has(id)) parent.set(id, id);
  for (const id of visible) {
    for (const pt of graph.partners(id)) {
      if (visible.has(pt.id)) union(id, pt.id);
    }
  }

  const groups = new Map();
  for (const id of visible) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }

  const units = [];
  const unitOf = new Map();
  for (const ids of groups.values()) {
    ids.sort((a, b) => String(a).localeCompare(String(b)));
    const unit = { id: `u:${ids[0]}`, memberIds: ids, offsets: new Map(), row: 0, x: 0 };
    if (ids.length === 1) {
      unit.offsets.set(ids[0], 0);
      unit.anchorId = ids[0];
    } else {
      // Anchor = the active person if they're in this pod (so the pod composes
      // around THEM), else the member holding the pod together.
      const partnerCountIn = (id) => graph.partners(id).filter((pt) => ids.includes(pt.id)).length;
      const anchor = ids.includes(activeId)
        ? activeId
        : [...ids].sort((a, b) => (partnerCountIn(b) - partnerCountIn(a)) || String(a).localeCompare(String(b)))[0];
      const statusOf = new Map(graph.partners(anchor).map((pt) => [pt.id, pt.status]));
      const others = ids.filter((id) => id !== anchor).sort(byBirthThenId(graph.byId));
      // Former partners to the left of the anchor, current to the right —
      // a remarried person sits between the two chapters of their life.
      const left = others.filter((id) => statusOf.get(id) === 'former');
      const right = others.filter((id) => statusOf.get(id) !== 'former');
      unit.offsets.set(anchor, 0);
      left.forEach((id, i) => unit.offsets.set(id, -(i + 1) * POD_GAP));
      right.forEach((id, i) => unit.offsets.set(id, (i + 1) * POD_GAP));
      unit.anchorId = anchor;
    }
    // Pod width, used when packing units along a row.
    const offs = [...unit.offsets.values()];
    unit.left = Math.min(...offs) - NODE_RADIUS;
    unit.right = Math.max(...offs) + NODE_RADIUS;
    unit.width = unit.right - unit.left;
    units.push(unit);
    for (const id of ids) unitOf.set(id, unit);
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
 */
function collectNear(graph, visible, activeId, unitOf) {
  const near = new Set();
  const add = (id) => {
    if (!visible.has(id) || near.has(id)) return;
    for (const m of unitOf.get(id)?.memberIds ?? [id]) near.add(m);
  };
  add(activeId);
  const parents = graph.parents(activeId).filter((q) => visible.has(q.id)).map((q) => q.id);
  parents.forEach(add);
  for (const pid of parents) {
    graph.parents(pid).forEach((q) => add(q.id));      // grandparents
    graph.children(pid).forEach((q) => add(q.id));      // siblings
  }
  for (const s of graph.siblings?.(activeId) ?? []) add(s.id);
  const kids = graph.children(activeId).filter((q) => visible.has(q.id)).map((q) => q.id);
  kids.forEach(add);
  for (const kid of kids) graph.children(kid).forEach((q) => add(q.id)); // grandchildren
  // Nieces and nephews: children of the active person's siblings.
  for (const id of [...near]) {
    if (id === activeId) continue;
    const r = graph.parents(id).some((q) => parents.includes(q.id));
    if (r) graph.children(id).forEach((q) => add(q.id));
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
  const parentIds = graph.parents(activeId).filter((q) => visible.has(q.id) && isBioAdopt(q.qualifier)).map((q) => q.id);
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

  /* 3. The parents' pod, centred over the sibling rank it produced. */
  if (parentIds.length) {
    const pUnit = unitOf.get(parentIds[0]);
    if (pUnit && !placed.has(pUnit.id)) {
      const span = sibUnits.length ? sibUnits.map((u) => placed.get(u.id)) : [0];
      placed.set(pUnit.id, (Math.min(...span) + Math.max(...span)) / 2);
    }
    /* 4. Grandparents, centred over the parent pod. */
    for (const pid of parentIds) {
      const gps = graph.parents(pid).filter((q) => visible.has(q.id)).map((q) => q.id);
      if (!gps.length) continue;
      const gUnit = unitOf.get(gps[0]);
      if (gUnit && !placed.has(gUnit.id)) placed.set(gUnit.id, placed.get(unitOf.get(pid).id) ?? 0);
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
