/*
 * Atlas — the whole family as one world.
 *
 * Every other tree view in this codebase is ego-centric: the organic tree
 * reveals outward from a focus, Canopy plans a frame around a focus, Chart
 * re-roots on a focus. None of them ever computes where EVERYONE belongs.
 * This does — once, deterministically, with no physics — and the renderer
 * (AtlasStage.jsx) then treats the result as a map: a continuous camera
 * zooms from "the family as a shape" down to faces, and selecting a person
 * is a flight, never a re-plan. Nothing ever rearranges under you.
 *
 *   planAtlas(graph) → { nodes, units, bonds, rows, bounds, eras, stats }
 *
 * The output deliberately matches the SHAPE Canopy's renderer already draws
 * (plan.js's frame: nodes Map, units with offsets/anchorMemberIds, bonds of
 * kind union/thread/descent), so render.js's bonds, pods and CanopyNode are
 * reused as-is rather than rebuilt. Canopy's motion and choreography were
 * always the asset; its planner was the keyhole. This is the planner that
 * doesn't refuse to draw the whole tree.
 *
 * Layout, in four steps:
 *   1. rows  — rankRows: generation RELATIVE to a root (a breadth-first walk
 *              over parent/child/partner edges), repaired so every parent is
 *              strictly above every child and current partners are level.
 *              Not depth-from-the-eldest-root, which measures how far back a
 *              line happens to be researched (see rankRows).
 *   2. units — a person appears exactly ONCE. Current partners on the same
 *              row share a rigid pod (the partner they share most children
 *              with, when there are several). Everyone else is a solo unit.
 *              A former partner, or a further current partner, is never
 *              podded — the link is drawn laterally instead, and counted in
 *              stats so the real data can decide whether that policy holds
 *              at scale (the one hard decision, made with a number).
 *   3. order — barycenter sweeps down and up the rows so the roots and any
 *              free-floating units fall into a crossing-minimised sequence.
 *   4. x     — a TIDY TREE. Each unit hangs under one primary parent unit,
 *              turning the family DAG into a forest; every subtree is given
 *              a span wide enough for all its descendants, siblings sit side
 *              by side in birth order, and a parent centres over the block
 *              of families it produced. That is what makes ancestors spread
 *              to stand over their descendants instead of staying compact
 *              while children sprawl away from them — the first build's
 *              long ropes across the picture, now gone. A second parent
 *              (a spouse's own ancestry, a cousin marriage) keeps its line
 *              drawn across to wherever it stands.
 *
 * Pure: no DOM, no canvas, no randomness. Same graph → byte-identical
 * output (every sort ends in an id comparison). Fast: linear in people.
 */

import { isBioOrAdoptive } from '../../data/graph.js';

export const ROW_GAP = 340;     // vertical distance between generations — Canopy density, so the close view fills instead of floating in paper
export const NODE_R = 54;       // person radius, same as Canopy's
export const POD_GAP = 124;     // centre-to-centre inside a couple
export const UNIT_GAP = 30;     // clear space between neighbouring units
export const FAMILY_GAP = 48;   // extra air around one couple's block of children

/* A descent that reaches far — across several rows (a partner levelled down
 * to a spouse's deeper generation) or a long way along one (a child standing
 * under their other parent) — is true, counted, and drawn differently from a
 * child hanging one row under their parents. One definition, shared by the
 * stats and the renderer, so the number on screen is the number drawn. */
export const FAR_REACH_X = 1100;
export function isFarReach(dx, dy) {
  return Math.abs(dy) > ROW_GAP * 1.5 || Math.abs(dx) > FAR_REACH_X;
}
const ORDER_SWEEPS = 4;

const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function labelHalf(person) {
  const raw = (person?.display_name || 'Unknown').trim();
  const parts = raw.split(/\s+/);
  const text = parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : raw;
  return Math.min(150, Math.max(NODE_R, text.length * 15 * 0.31 + 8));
}

function yearOf(s) {
  const m = String(s || '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

/* Rows are RELATIVE generations, not depth from the eldest recorded root.
 *
 * computeGenerations (graph.js) counts each person's row as the longest
 * chain of recorded ancestors above them, then levels partners onto the
 * deeper one. Right for the ego-centred organic tree; wrong for a whole
 * family map. On the real tree it put Matthew (b. 1980) ten rows below his
 * own mother: Kaitlin's line is researched ten generations back and his is
 * researched three, so she was ranked ten deep, he was levelled down to
 * her, and the line from Heather to her son became a rope through six empty
 * generation bands while his brother stayed up beside her. Depth of
 * research is not a fact about the family.
 *
 * Instead every person's row is their generation RELATIVE to a root: a
 * breadth-first walk from one well-connected person over parent (−1),
 * child (+1) and current-partner (0) edges, so a parent is one row up
 * whether their own line is recorded for two generations or twenty. The
 * two invariants the layout promises are then repaired exactly the way
 * computeGenerations does — level current partners, cascade children
 * strictly below parents, until nothing moves — but starting from labels
 * that are already consistent almost everywhere, so a repair is a local
 * nudge around a genuine generational skew (a cousin marriage, a second
 * family a generation late), never a cascade. Rows are normalised so the
 * eldest row is 0. Deterministic: the root is chosen by degree then id,
 * and the walk visits neighbours in the graph's own stable order. */
export function rankRows(graph, rootId = null) {
  const rank = new Map();
  if (!graph.people.length) return rank;
  const has = (id) => graph.byId.has(id);
  const degree = (id) => graph.parents(id).length + graph.children(id).length + graph.partners(id).filter((pt) => pt.status !== 'former').length;
  const ids = graph.people.map((p) => p.id).sort(cmpId);
  let root = rootId && has(rootId) ? rootId : null;
  if (!root) {
    let best = -1;
    for (const id of ids) { const d = degree(id); if (d > best) { best = d; root = id; } }
  }
  const walk = (seed) => {
    rank.set(seed, 0);
    const queue = [seed];
    for (let qi = 0; qi < queue.length; qi++) {
      const id = queue[qi], r = rank.get(id);
      const step = (nid, d) => { if (has(nid) && !rank.has(nid)) { rank.set(nid, r + d); queue.push(nid); } };
      for (const p of graph.parents(id)) step(p.id, -1);
      for (const c of graph.children(id)) step(c.id, 1);
      for (const pt of graph.partners(id)) if (pt.status !== 'former') step(pt.id, 0);
    }
  };
  walk(root);
  for (const id of ids) if (!rank.has(id)) walk(id);

  // Repair, exactly as computeGenerations: both rules only ever move a person
  // DEEPER, so the sum of ranks is monotone and bounded — it converges.
  let stable = false;
  let guard = graph.people.length * 4 + 10;
  while (!stable && guard-- > 0) {
    stable = true;
    let leveling = true;
    while (leveling) {
      leveling = false;
      for (const id of ids) {
        for (const pt of graph.partners(id)) {
          if (pt.status === 'former' || !has(pt.id)) continue;
          const a = rank.get(id), b = rank.get(pt.id);
          if (a === b) continue;
          const lvl = Math.max(a, b);
          if (a !== lvl) rank.set(id, lvl);
          if (b !== lvl) rank.set(pt.id, lvl);
          leveling = true; stable = false;
        }
      }
    }
    for (const id of ids) {
      const r = rank.get(id);
      for (const c of graph.children(id)) {
        if (!has(c.id)) continue;
        if (rank.get(c.id) <= r) { rank.set(c.id, r + 1); stable = false; }
      }
    }
  }
  let min = Infinity;
  for (const r of rank.values()) min = Math.min(min, r);
  for (const [id, r] of rank) rank.set(id, r - min);
  return rank;
}

export function planAtlas(graph, opts = {}) {
  const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const byId = graph.byId;
  const empty = { focusId: null, nodes: new Map(), units: [], bonds: [], rows: new Map(), bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, eras: [], stats: { people: 0, units: 0, generations: 0, lateralUnions: 0, longDescents: 0, crossings: 0, layoutMs: 0 } };
  if (!graph.people.length) return empty;

  const gen = rankRows(graph, opts.rootId);
  const birth = (id) => byId.get(id)?.birth_date || '';
  const byBirthThenId = (a, b) => {
    const da = birth(a), db = birth(b);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return cmpId(a, b);
  };
  const isConnected = (id) => graph.parents(id).length || graph.children(id).length || graph.partners(id).length;

  /* ── 2. Units ─────────────────────────────────────────────────────────── */
  const sharedKids = (a, b) => {
    let n = 0;
    for (const c of graph.children(a)) {
      if (!isBioOrAdoptive(c.qualifier)) continue;
      if (graph.parents(c.id).some((p) => p.id === b && isBioOrAdoptive(p.qualifier))) n++;
    }
    return n;
  };
  const unitOf = new Map();
  const units = [];
  const ids = graph.people.map((p) => p.id).sort(byBirthThenId);
  for (const id of ids) {
    if (unitOf.has(id)) continue;
    const g = gen.get(id) ?? 0;
    let mate = null, best = -1;
    for (const pt of graph.partners(id)) {
      if (pt.status === 'former' || !byId.has(pt.id) || unitOf.has(pt.id)) continue;
      if ((gen.get(pt.id) ?? 0) !== g) continue;
      const s = sharedKids(id, pt.id);
      if (s > best || (s === best && cmpId(pt.id, mate) < 0)) { best = s; mate = pt.id; }
    }
    const members = mate ? [id, mate].sort(byBirthThenId) : [id];
    const halves = members.map((m) => labelHalf(byId.get(m)));
    const gap = members.length === 2 ? Math.max(POD_GAP, halves[0] + halves[1] + 16) : 0;
    const span = (members.length - 1) * gap;
    const offsets = new Map();
    members.forEach((m, i) => offsets.set(m, i * gap - span / 2));
    const u = {
      id: `u:${members[0]}`,
      memberIds: members,
      anchorMemberIds: [],
      offsets,
      labelHalfWidths: new Map(members.map((m, i) => [m, halves[i]])),
      gap,
      row: g,
      x: 0,
      halfW: span / 2 + Math.max(...halves),
      band: 'kin',
      kind: members.length > 1 ? 'pod' : 'single',
      anchorId: members[0],
      connected: members.some(isConnected),
      status: mate ? (graph.partners(id).find((pt) => pt.id === mate)?.status || 'current') : null,
    };
    for (const m of members) unitOf.set(m, u);
    units.push(u);
  }

  /* ── Parentage ─────────────────────────────────────────────────────────────
   *
   * Two different questions, deliberately answered separately, because
   * conflating them made the map tell a lie.
   *
   * WHAT IS DRAWN (parentGroups) must be exact. Every recorded parent edge
   * is represented, grouped by its own qualifier, so a child with two
   * biological parents and a step-parent gets a solid connector to the
   * couple AND a dashed one to the step-parent. The first build kept only
   * the biological edges whenever any existed, which meant a step-parent
   * silently had no line to their step-child at all — a real relationship
   * the rest of the app draws (dashed) everywhere else, vanishing here.
   * Grouping by qualifier rather than emitting one line per edge keeps a
   * plain couple as one connector; a mixed couple (one biological parent,
   * one adoptive) honestly gets one line per qualifier, each reaching only
   * the parents actually recorded that way. No connector ever implies a
   * parent who is not recorded, and no recorded parent loses their line.
   *
   * WHERE A CHILD SITS (structuralParents) is a layout choice, not a claim:
   * a child hangs beneath the line they descend from, so blood is preferred
   * and step is used only when there is nothing else. That preference moves
   * nobody's connector — it only decides which subtree owns the child. */
  const normQualifier = (q) => (q === 'adopted' ? 'adoptive' : isBioOrAdoptive(q) ? (q || 'biological') : q);
  const parentGroups = new Map(); // childId -> [{ ids: [parentId], qualifier }]
  const structuralParents = new Map(); // childId -> { ids: [parentId] }
  for (const p of graph.people) {
    const all = graph.parents(p.id).filter((x) => byId.has(x.id));
    if (!all.length) continue;
    const byQualifier = new Map();
    for (const x of all) {
      const q = normQualifier(x.qualifier);
      if (!byQualifier.has(q)) byQualifier.set(q, []);
      byQualifier.get(q).push(x.id);
    }
    const groups = [...byQualifier.entries()]
      .map(([qualifier, ids]) => ({ qualifier, ids: ids.slice().sort(cmpId) }))
      .sort((a, b) => cmpId(a.qualifier, b.qualifier));
    parentGroups.set(p.id, groups);
    const blood = all.filter((x) => isBioOrAdoptive(x.qualifier));
    const use = blood.length ? blood : all;
    structuralParents.set(p.id, { ids: use.map((x) => x.id).sort(cmpId) });
  }
  /* Ordering minimises crossings among the lines actually DRAWN, so it reads
   * every group — a step connector crossing the picture is exactly as ugly
   * as a biological one. */
  const upUnits = new Map();
  const downUnits = new Map();
  for (const [cid, groups] of parentGroups) {
    const cu = unitOf.get(cid);
    for (const g of groups) {
      for (const pid of g.ids) {
        const pu = unitOf.get(pid);
        if (!pu || pu === cu) continue;
        if (!upUnits.has(cu)) upUnits.set(cu, new Set());
        if (!downUnits.has(pu)) downUnits.set(pu, new Set());
        upUnits.get(cu).add(pu);
        downUnits.get(pu).add(cu);
      }
    }
  }

  /* ── 3. Order within rows (roots and free units) ───────────────────────── */
  const rows = new Map();
  for (const u of units) {
    if (!rows.has(u.row)) rows.set(u.row, []);
    rows.get(u.row).push(u);
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  const pos = new Map();
  const setPositions = (arr) => arr.forEach((u, i) => pos.set(u, i));
  const eldest = (u) => u.memberIds.slice().sort(byBirthThenId)[0];
  const tieBreak = (a, b) => byBirthThenId(eldest(a), eldest(b)) || cmpId(a.id, b.id);
  const meanPos = (set) => {
    if (!set || !set.size) return null;
    let s = 0;
    for (const u of set) s += pos.get(u) ?? 0;
    return s / set.size;
  };
  for (const r of rowKeys) { const arr = rows.get(r); arr.sort(tieBreak); setPositions(arr); }
  const sortRow = (r, keyOf) => {
    const arr = rows.get(r);
    const keyed = arr.map((u, i) => ({ u, i, k: keyOf(u) }));
    keyed.sort((a, b) => {
      const ac = a.u.connected ? 0 : 1, bc = b.u.connected ? 0 : 1;
      if (ac !== bc) return ac - bc;
      const ka = a.k ?? a.i, kb = b.k ?? b.i;
      if (ka !== kb) return ka - kb;
      return tieBreak(a.u, b.u);
    });
    const next = keyed.map((x) => x.u);
    rows.set(r, next);
    setPositions(next);
  };
  for (let s = 0; s < ORDER_SWEEPS; s++) {
    for (let i = 1; i < rowKeys.length; i++) sortRow(rowKeys[i], (u) => meanPos(upUnits.get(u)));
    for (let i = rowKeys.length - 2; i >= 0; i--) sortRow(rowKeys[i], (u) => meanPos(downUnits.get(u)));
  }

  /* ── 4. X placement: a tidy tree over the unit forest ─────────────────── */
  // Each unit hangs under ONE primary parent unit: the parents of its first
  // (eldest) member with recorded parents, strictly above it. A pod has two
  // sets of parents; one side is the line it hangs from, the other side's
  // descent is still drawn, across to wherever they stand.
  const primaryParent = new Map();
  for (const u of units) {
    for (const m of u.memberIds) {
      const cp = structuralParents.get(m);
      if (!cp) continue;
      const pu = unitOf.get(cp.ids[0]);
      if (pu && pu !== u && pu.row < u.row) { primaryParent.set(u, pu); break; }
    }
  }
  const kids = new Map();
  for (const [u, p] of primaryParent) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(u); }
  for (const arr of kids.values()) arr.sort(tieBreak);
  const ownW = (u) => 2 * u.halfW + UNIT_GAP;
  const widthMemo = new Map();
  const widthOf = (u) => {
    if (widthMemo.has(u)) return widthMemo.get(u);
    const ch = kids.get(u) || [];
    let w = ownW(u);
    if (ch.length) {
      let s = FAMILY_GAP;
      for (const c of ch) s += widthOf(c);
      w = Math.max(w, s);
    }
    widthMemo.set(u, w);
    return w;
  };
  const place = (u, left) => {
    const w = widthOf(u);
    u.x = left + w / 2;
    const ch = kids.get(u) || [];
    if (!ch.length) return;
    let s = 0;
    for (const c of ch) s += widthOf(c);
    let cursor = left + (w - s) / 2;
    for (const c of ch) { place(c, cursor); cursor += widthOf(c); }
  };
  // Roots — units with no primary parent — laid out left to right in the
  // crossing-minimised order, top row first: founders' whole subtrees, then
  // anyone deeper who has no recorded ancestry and isn't inside a pod (a
  // hub's further partners, the not-yet-connected), each appended after
  // the subtrees already standing.
  let cursor = 0;
  for (const r of rowKeys) {
    for (const u of rows.get(r)) {
      if (primaryParent.has(u)) continue;
      place(u, cursor);
      cursor += widthOf(u);
    }
  }
  // Tidy placement gives every subtree its own span, so rows can't overlap
  // — this pass only exists to make that a guarantee rather than a belief.
  const need = (a, b) => a.halfW + b.halfW + UNIT_GAP;
  for (const r of rowKeys) {
    const arr = rows.get(r).slice().sort((a, b) => a.x - b.x || cmpId(a.id, b.id));
    for (let i = 1; i < arr.length; i++) {
      const lo = arr[i - 1].x + need(arr[i - 1], arr[i]);
      if (arr[i].x < lo) arr[i].x = lo;
    }
    rows.set(r, arr);
  }
  const memberX = (u, id) => u.x + (u.offsets.get(id) || 0);

  /* ── Bonds ─────────────────────────────────────────────────────────────── */
  const bonds = [];
  const anchors = new Map();
  const ensureAnchor = (pids, row) => {
    const key = `${row}:${pids.join('|')}`;
    if (anchors.has(key)) return anchors.get(key);
    const a = {
      id: `a:${key}`, memberIds: [], anchorMemberIds: pids, offsets: new Map(),
      labelHalfWidths: new Map(), band: 'kin', row, x: 0, anchorId: pids[0],
      kind: 'junction', anchorOnly: true,
    };
    anchors.set(key, a);
    units.push(a);
    return a;
  };
  let lateralUnions = 0;
  const unionSeen = new Set();
  for (const u of units) {
    if (u.anchorOnly || u.memberIds.length < 2) continue;
    const [a, b] = u.memberIds;
    unionSeen.add([a, b].sort(cmpId).join('|'));
    bonds.push({ kind: 'union', a, b, status: u.status === 'former' ? 'former' : u.status === 'widowed' ? 'widowed' : 'current' });
  }
  for (const p of graph.people) {
    for (const pt of graph.partners(p.id)) {
      if (!byId.has(pt.id)) continue;
      const key = [p.id, pt.id].sort(cmpId).join('|');
      if (unionSeen.has(key)) continue;
      unionSeen.add(key);
      lateralUnions++;
      if (pt.status === 'former') bonds.push({ kind: 'union', a: p.id, b: pt.id, status: 'former' });
      else bonds.push({ kind: 'thread', a: p.id, b: pt.id });
    }
  }
  for (const [cid, groups] of parentGroups) {
    for (const { ids: pids, qualifier } of groups) {
      const pu = unitOf.get(pids[0]);
      if (!pu) continue;
      // A connector may anchor on a whole unit only when the group IS that
      // unit — otherwise it gets a junction on exactly the parents recorded
      // with this qualifier, so the line never reaches through someone who
      // holds a different relationship to the child (or none at all).
      const sameUnit = pids.every((id) => unitOf.get(id) === pu);
      const exact = sameUnit && pids.length === pu.memberIds.length;
      const parentUnit = exact ? pu : ensureAnchor(pids, Math.max(...pids.map((id) => gen.get(id) ?? 0)));
      bonds.push({ kind: 'descent', parentUnit: parentUnit.id, child: cid, qualifier });
    }
  }
  const descentParents = [...new Set(bonds.filter((b) => b.kind === 'descent').map((b) => b.parentUnit))].sort(cmpId);
  const level = new Map(descentParents.map((id, i) => [id, i % 3]));
  for (const b of bonds) if (b.kind === 'descent') b.junctionLevel = level.get(b.parentUnit) ?? 0;

  /* ── Resolve nodes ─────────────────────────────────────────────────────── */
  const nodes = new Map();
  for (const u of units) {
    if (u.anchorOnly) continue;
    const y = u.row * ROW_GAP;
    for (const m of u.memberIds) {
      nodes.set(m, {
        id: m, unitId: u.id,
        x: memberX(u, m), y,
        rowBaselineY: y, anchorY: y,
        row: u.row, rank: 0, band: 'kin',
        r: NODE_R,
        labelHalfWidth: u.labelHalfWidths.get(m) || NODE_R,
        isFocus: false, satellite: false,
      });
    }
  }
  for (const a of anchors.values()) {
    const xs = a.anchorMemberIds.map((id) => nodes.get(id)?.x).filter((x) => x != null);
    a.x = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes.values()) {
    const hw = Math.max(n.r, n.labelHalfWidth);
    minX = Math.min(minX, n.x - hw); maxX = Math.max(maxX, n.x + hw);
    minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + 40);
  }
  const shift = (minX + maxX) / 2;
  for (const n of nodes.values()) n.x -= shift;
  for (const u of units) u.x -= shift;
  minX -= shift; maxX -= shift;

  /* ── Eras: one label per generation row (median birth decade) ────────── */
  // The axis speaks one language: decades when every dated row carries a
  // plausible one, generation numbers otherwise — never a mix of the two
  // down one margin (a fixture with synthetic future dates showed "2000s"
  // between "Gen 1" and "Gen 9", which reads as a bug rather than an axis).
  const thisYear = new Date().getFullYear() + 1;
  const medians = rowKeys.map((r) => {
    const years = rows.get(r).flatMap((u) => u.memberIds.map((m) => yearOf(birth(m)))).filter(Boolean).sort((a, b) => a - b);
    return years.length ? years[Math.floor(years.length / 2)] : null;
  });
  const decades = medians.some((m) => m != null) && medians.every((m) => m == null || (m > 1000 && m <= thisYear));
  const eras = rowKeys.map((r, i) => {
    const median = medians[i];
    const label = decades && median != null ? `${Math.floor(median / 10) * 10}s` : `Gen ${r + 1}`;
    return { row: r, y: r * ROW_GAP, label, count: rows.get(r).reduce((s, u) => s + u.memberIds.length, 0) };
  });

  /* ── Stats: let the data answer the layout questions ───────────────────── */
  let longDescents = 0;
  const spans = new Map();
  const unitById = new Map(units.map((u) => [u.id, u]));
  for (const b of bonds) {
    if (b.kind !== 'descent') continue;
    const pu = unitById.get(b.parentUnit);
    const c = nodes.get(b.child);
    if (!pu || !c) continue;
    if (isFarReach(c.x - pu.x, c.y - pu.y)) longDescents++;
    if (!spans.has(c.row)) spans.set(c.row, []);
    spans.get(c.row).push({ x0: pu.x, x1: c.x });
  }
  let crossings = 0;
  for (const list of spans.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if ((a.x0 - b.x0) * (a.x1 - b.x1) < 0) crossings++;
      }
    }
  }
  const ended = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const stats = {
    people: nodes.size,
    units: units.filter((u) => !u.anchorOnly).length,
    generations: rowKeys.length,
    lateralUnions,
    longDescents,
    crossings,
    layoutMs: Math.round(ended - started),
  };
  return { focusId: opts.focusId ?? null, nodes, units, bonds, rows, bounds: { minX, maxX, minY, maxY }, eras, stats };
}
