/*
 * Atlas — plates.
 *
 * A tidy tree of a growing family is a TRIANGLE, and that is the whole
 * problem. Measured on the fixtures this view is judged against: population
 * roughly doubles each generation, so at 1,200 people one generation holds
 * 308 of them in a single row and at 5,000 people one holds 1,414 — and
 * that one row IS the entire width of the map. Height is fixed by the
 * generation count. The result is a bounding box of 15:1, then 50:1, about
 * 95% of it empty, and framing it forces a scale at which the family is a
 * hairline smeared across a tall window.
 *
 * So the map becomes an ATLAS in the literal sense: not one enormous sheet,
 * but PLATES. The family is cut into blocks at branch boundaries, each block
 * is laid out as its own tidy tree, and the blocks are packed into something
 * the shape of a screen. Measured: 15.2:1 → 1.59:1, and 50.3:1 → 1.72:1.
 *
 * Two findings from prototyping this, both of which changed the design:
 *
 *   - Cutting alone only reaches 3.5:1. A branch inherits the global
 *     layout's sparseness and the TRUNK inherits all of it — shared
 *     ancestors sit spread across the entire width of the family, because
 *     that is where their descendants are, so the trunk plate came out
 *     95,000 units wide and nearly empty. Re-running the planner on each
 *     plate ALONE is what actually does the work.
 *
 *   - Drawing every link is worse than the smear. Only ~5-7% of parent
 *     links span two plates, but each one is enormous, and 82 of them
 *     sweep across the whole atlas and bury the structure inside every
 *     plate. They are tagged `crossPlate` here so the renderer can hold
 *     them back until you are close enough to be inside one plate — which
 *     is what an atlas does anyway: it does not draw the roads between its
 *     plates, it marks where they continue.
 *
 * Deliberately gated. Below `TRIGGER_ASPECT` nothing here runs and the
 * layout is byte-identical to what it has always been — a family that is
 * not pathologically wide should not be cut up to fix a problem it does
 * not have.
 *
 * Pure, and free of any import from layout.js (which calls INTO this):
 * the planner and graph builder arrive as arguments, so there is no import
 * cycle and the packing can be tested without a layout engine at all.
 */

/** Wider than this and the family is cut into plates. A tidy tree at 3:1 is
 *  still a readable shape on a screen; by 6:1 it is a smear. */
export const TRIGGER_ASPECT = 3.2;
/** What the packed atlas aims to be. Slightly wide of square: a family reads
 *  better in a shape closer to a page than a column, on both a desktop and a
 *  phone (which pans vertically far more comfortably than horizontally). */
export const TARGET_ASPECT = 1.5;

const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Every person lands on exactly one plate: their own major branch, or the
 *  trunk — the shared ancestry above where the branches part, plus every
 *  offshoot too small to be a region of its own. Assignment is first-come
 *  by branch size (branches arrive largest-first), so a person shared
 *  between two branches belongs to the bigger one and never to both. */
export function choosePlates(frame, minBranchPeople) {
  const plateOf = new Map();
  const plates = [];
  for (const b of frame.branches || []) {
    if (b.people < minBranchPeople) continue;
    const ids = [];
    for (const m of b.memberIds) if (!plateOf.has(m)) ids.push(m);
    if (!ids.length) continue;
    const p = { id: b.id, surname: b.surname, from: b.from, to: b.to, ids };
    for (const m of ids) plateOf.set(m, p);
    plates.push(p);
  }
  const rest = [];
  for (const [id] of frame.nodes) if (!plateOf.has(id)) rest.push(id);
  if (rest.length) {
    const trunk = { id: 'plate:trunk', surname: '', from: null, to: null, ids: rest.sort(cmpId) };
    for (const m of rest) plateOf.set(m, trunk);
    plates.unshift(trunk);
  }
  return { plates, plateOf };
}

/** Shelf-pack: tallest first, left to right, wrapping at a target width.
 *  Each plate is a rigid block — its own internal layout is never touched,
 *  only translated — so nothing inside a family moves relative to anything
 *  else in that family. Pure: takes and returns plain numbers. */
export function packPlates(plates, targetW, gutterX, gutterY) {
  /* Ancestral plates first, so the shelves run roughly oldest-to-youngest
   * down the page. Plating gives up the global guarantee that every parent
   * sits above every child — two people on different plates have no shared
   * row to compare — but ordering by each plate's own earliest generation
   * keeps the great majority of cross-plate links pointing DOWNWARD, which
   * is the part of that guarantee a reader actually feels. */
  const order = [...plates].sort((a, z) => (a.gen0 ?? 0) - (z.gen0 ?? 0) || (z.h - a.h) || (z.w - a.w) || cmpId(a.id, z.id));
  let shelfY = 0, shelfX = 0, shelfH = 0, width = 0;
  const out = new Map();
  for (const p of order) {
    if (shelfX > 0 && shelfX + p.w > targetW) { shelfY += shelfH + gutterY; shelfX = 0; shelfH = 0; }
    out.set(p.id, { dx: shelfX - p.x0, dy: shelfY - p.y0 });
    shelfX += p.w + gutterX;
    shelfH = Math.max(shelfH, p.h);
    width = Math.max(width, shelfX - gutterX);
  }
  return { offsets: out, width, height: shelfY + shelfH };
}

/** Try a spread of target widths and keep whichever packs closest to the
 *  wanted aspect. Cheap — a handful of packs over a dozen-odd blocks — and
 *  it beats deriving a width analytically, since shelf packing is lumpy. */
export function bestPack(plates, wantAspect, gutterX, gutterY) {
  const area = plates.reduce((s, p) => s + p.w * p.h, 0);
  let best = null;
  for (let k = 1; k <= 40; k++) {
    const targetW = Math.sqrt(area * wantAspect) * (0.5 + k * 0.075);
    const r = packPlates(plates, targetW, gutterX, gutterY);
    if (!r.height || !r.width) continue;
    const score = Math.abs(Math.log((r.width / r.height) / wantAspect));
    if (!best || score < best.score) best = { ...r, score, aspect: r.width / r.height };
  }
  return best;
}

/* ── merging the plates back into one frame ─────────────────────────────── */

/** A descent whose parents sit on a different plate from the child. It is
 *  anchored on a junction carrying EXACTLY those parents — never on a whole
 *  pod that might include someone who is not a parent of this child, the
 *  same rule the map's own planner and the portrait lens both follow. */
function crossPlateBonds(graph, plateOf, nodes, norm) {
  const bonds = [];
  const units = [];
  const made = new Map();
  const ids = [...nodes.keys()].sort(cmpId);
  for (const childId of ids) {
    const mine = plateOf.get(childId);
    const byQ = new Map();
    for (const p of graph.parents(childId)) {
      if (!nodes.has(p.id) || plateOf.get(p.id) === mine) continue;
      const q = norm(p.qualifier);
      if (!byQ.has(q)) byQ.set(q, []);
      byQ.get(q).push(p.id);
    }
    for (const [q, parents] of [...byQ.entries()].sort((a, b) => cmpId(a[0], b[0]))) {
      parents.sort(cmpId);
      const key = parents.join('+');
      let unitId = made.get(key);
      if (!unitId) {
        unitId = `x:${key}`;
        made.set(key, unitId);
        const xs = parents.map((id) => nodes.get(id).x);
        units.push({
          id: unitId,
          memberIds: [],
          anchorMemberIds: parents,
          offsets: new Map(),
          labelHalfWidths: new Map(),
          row: nodes.get(parents[0]).row,
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          halfW: 0,
          band: 'kin',
          kind: 'single',
          anchorId: parents[0],
          anchorOnly: true,
        });
      }
      bonds.push({ kind: 'descent', parentUnit: unitId, child: childId, qualifier: q, crossPlate: true });
    }
  }
  return { bonds, units };
}

/**
 * Cut a too-wide frame into plates and pack them.
 *
 * @param frame  the frame the ordinary planner produced
 * @param graph  the graph it was produced from
 * @param opts   { layout, buildGraph, rowGap, minBranchPeople, norm,
 *                 want = TARGET_ASPECT }
 * @returns a new frame, or null when the family does not need plating.
 */
export function plateFrame(frame, graph, opts) {
  const { layout, buildGraph, rowGap, minBranchPeople, norm, want = TARGET_ASPECT } = opts;
  const bw = frame.bounds.maxX - frame.bounds.minX;
  const bh = frame.bounds.maxY - frame.bounds.minY;
  if (!bh || bw / bh <= TRIGGER_ASPECT) return null;

  const { plates, plateOf } = choosePlates(frame, minBranchPeople);
  if (plates.length < 2) return null;

  // Each plate, re-laid-out on the induced subgraph of just its members.
  const personById = new Map(graph.people.map((p) => [p.id, p]));
  for (const p of plates) {
    const set = new Set(p.ids);
    const people = p.ids.map((id) => personById.get(id)).filter(Boolean);
    const rels = graph.relationships.filter((r) => set.has(r.from_person) && set.has(r.to_person));
    p.local = layout(buildGraph(people, rels), { plates: false });
    p.w = p.local.bounds.maxX - p.local.bounds.minX;
    p.h = p.local.bounds.maxY - p.local.bounds.minY;
    p.x0 = p.local.bounds.minX;
    p.y0 = p.local.bounds.minY;
    p.people = p.ids.length;
    // The plate's own earliest generation IN THE ORIGINAL layout — the one
    // frame where every plate's rows are still comparable — so packing can
    // order them oldest-first (see packPlates).
    p.gen0 = Math.min(...p.ids.map((id) => frame.nodes.get(id)?.row ?? 0));
    // A region with no name cannot be labelled, and the trunk has no single
    // branch surname of its own: take the commonest among its people.
    if (!p.surname) {
      const tally = new Map();
      for (const id of p.ids) {
        const name = (personById.get(id)?.display_name || '').trim().split(/\s+/).pop();
        if (name) tally.set(name, (tally.get(name) || 0) + 1);
      }
      let top = null;
      for (const [name, n] of tally) if (!top || n > top.n || (n === top.n && name < top.name)) top = { name, n };
      p.surname = top ? top.name : '';
    }
  }

  const gutterX = rowGap * 1.6, gutterY = rowGap * 1.1;
  const packed = bestPack(plates, want, gutterX, gutterY);
  if (!packed) return null;
  for (const p of plates) {
    const o = packed.offsets.get(p.id) || { dx: 0, dy: 0 };
    p.dx = o.dx; p.dy = o.dy;
  }

  /* ── merge ── */
  const nodes = new Map();
  const units = [];
  const bonds = [];
  for (const p of plates) {
    for (const [id, n] of p.local.nodes) {
      nodes.set(id, {
        ...n,
        x: n.x + p.dx,
        y: n.y + p.dy,
        rowBaselineY: (n.rowBaselineY ?? n.y) + p.dy,
        anchorY: (n.anchorY ?? n.y) + p.dy,
        plate: p.id,
      });
    }
    for (const u of p.local.units) units.push({ ...u, x: u.x + p.dx, plate: p.id });
    for (const b of p.local.bonds) bonds.push(b);
  }
  const cross = crossPlateBonds(graph, plateOf, nodes, norm);
  units.push(...cross.units);
  bonds.push(...cross.bonds);

  /* ── the plates become the named regions the far view already draws ── */
  const branches = plates.map((p) => {
    const bandByRow = new Map();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
    for (const id of p.ids) {
      const n = nodes.get(id);
      if (!n) continue;
      const band = bandByRow.get(n.row) || { row: n.row, y: n.y, x0: Infinity, x1: -Infinity };
      band.x0 = Math.min(band.x0, n.x - n.r);
      band.x1 = Math.max(band.x1, n.x + n.r);
      band.y = Math.min(band.y, n.y);
      bandByRow.set(n.row, band);
      x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y);
    }
    const bands = [...bandByRow.values()].sort((a, b) => a.row - b.row);
    return {
      id: p.id,
      headUnitId: null,
      people: p.people,
      memberIds: p.ids.slice(),
      surname: p.surname,
      from: p.from,
      to: p.to,
      bands,
      x: (x0 + x1) / 2,
      y: y0,
      minor: false,
    };
  }).filter((b) => b.bands.length);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [, n] of nodes) {
    minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + 40);
  }

  return {
    ...frame,
    nodes,
    units,
    bonds,
    branches,
    /* One era axis down the left can only speak for a layout where every
     * generation shares a row, and plates deliberately give that up: each
     * plate keeps its own generations, and they do not line up between
     * plates. Publishing an axis that no longer describes the picture would
     * be worse than publishing none. */
    eras: [],
    bounds: { minX, maxX, minY, maxY },
    plates: branches.map((b) => b.id),
    stats: {
      ...frame.stats,
      branches: branches.length,
      plates: branches.length,
      plateAspect: Math.round((packed.width / packed.height) * 100) / 100,
    },
  };
}
