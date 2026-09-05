/*
 * The Family Portrait — the neighbourhood, composed.
 *
 * The Atlas is a map: everyone has a permanent place, and that permanence is
 * the whole point. But a map is not a family. Landing on someone in a
 * thousand-person tree puts you in a narrow vertical slice of it — four
 * portraits floating in a very large document — and the people who actually
 * matter to the person you just travelled to are scattered by the layout's
 * own logic: a partner beside them, a mother two screens left because her
 * line is where the tidy tree put it, a child under their other parent.
 *
 * So selection LIFTS them. The immediate family gathers into a deliberately
 * composed group around the person in focus, drawn in the foreground while
 * the map dims and stays geographically present underneath. Nobody appears
 * twice: a lifted person fades out of their permanent place for as long as
 * they are held in the portrait, and returns to it when it closes.
 *
 *   composePortrait(graph, focusId) → a Canopy-shaped frame
 *
 * The output deliberately matches the shape Canopy's renderer already draws
 * (nodes / units / bonds), so the portrait gets the same pods, the same
 * tapered descent ribbons and the same dashed step edges as everywhere else
 * in the app, rather than a second visual language for the same facts.
 * Positions are WORLD offsets from the focus person's own place on the map,
 * so the portrait sits exactly where they are, pans and zooms with the map,
 * and its opening reads as the family gathering around them rather than a
 * panel sliding over the top.
 *
 * Truthfulness rules, which is where the difficulty actually lives:
 *   - Every relationship drawn is one that is recorded. A step-parent is
 *     drawn as a step-parent, an ex as an ex, a half-sibling through the one
 *     parent they actually share.
 *   - No connector implies a parent who is not recorded: children hang from
 *     the exact parents they have, which for a child of a former partner is
 *     not the couple you are looking at.
 *   - Nothing is invented to make the composition tidy. An unknown parent is
 *     an absence, and the shape simply closes around it.
 *
 * Pure: no DOM, no canvas, no randomness. Same graph and focus → identical
 * output, so a composition can be asserted rather than eyeballed.
 */

import { isBioOrAdoptive } from '../../data/graph.js';
import { NODE_R, ROW_GAP, POD_GAP } from './layout.js';

/* The composed geometry. Generous next to the map's own spacing — this is
 * the one place in the view that is allowed to be a portrait rather than a
 * diagram, so it gets room to breathe. */
const GEN = ROW_GAP * 1.02;      // parents above, children below
const MATE = POD_GAP * 1.16;     // a partner beside
const EX = MATE * 1.25;          // ...a former one a little further off, clear of the focus's own name
const SIB_GAP = POD_GAP * 1.34;  // siblings out to the sides
const SIB_LIFT = ROW_GAP * 0.13; // ...on a shallow arc, so they read as beside rather than in line
const KID_GAP = POD_GAP * 1.2;

/* A row that just keeps growing sideways is the one shape this composer
 * cannot make legible: a blended family with several ex-partners, a large
 * sibling group, or a big family under one couple all reach for the same
 * fix — wrap. Measured against the real fixtures this is built for (not
 * just imagined): the widest portrait in a 1,200-person family is someone
 * with eight recorded current partners in one straight line, 2,684 units
 * across — wider than a phone AND a desktop at the lens's own minimum
 * readable zoom. Capping every arm at a few per row and stacking the rest
 * keeps the group together without any one row outrunning the frame.
 * ROW_STACK is kept well short of GEN, so even a few wrapped rows land
 * short of the next generation's own row rather than colliding with it. */
const MAX_ARM = 4;               // partners/siblings per row before wrapping
const MAX_KID_ROW = 4;           // children per row within one couple's group
const ROW_STACK = NODE_R * 2.4;

const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const armCols = (n) => Math.min(Math.max(n, 1), MAX_ARM);
const gridRC = (i, cols) => ({ col: i % cols, row: Math.floor(i / cols) });

function byBirth(graph) {
  return (a, b) => {
    const da = graph.byId.get(a)?.birth_date || '', db = graph.byId.get(b)?.birth_date || '';
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return cmpId(a, b);
  };
}

const norm = (q) => (q === 'adopted' ? 'adoptive' : isBioOrAdoptive(q) ? (q || 'biological') : q);

/** Roles are what the portrait CLAIMS about each person; they must be
 *  derivable from a recorded edge, never from position. */
export const ROLES = ['focus', 'partner', 'former-partner', 'parent', 'step-parent', 'child', 'sibling'];

export function composePortrait(graph, focusId) {
  const person = graph.byId.get(focusId);
  if (!person) return null;
  const order = byBirth(graph);

  /* ── Who belongs in the portrait ─────────────────────────────────────── */
  const partners = graph.partners(focusId).filter((p) => graph.byId.has(p.id));
  const current = partners.filter((p) => p.status !== 'former').map((p) => p.id).sort(order);
  const formers = partners.filter((p) => p.status === 'former').map((p) => p.id).sort(order);

  /* Two people can share a child without ever having been a couple — a bio
   * mother and an adoptive father, co-parents who separated before the tree
   * recorded them. The portrait only ever pods, or draws a union between,
   * people with a partner edge of their own. */
  const partnerStatus = (a, b) => graph.partners(a).find((p) => p.id === b)?.status ?? null;

  const parentEdges = graph.parents(focusId).filter((p) => graph.byId.has(p.id));
  const bloodParents = parentEdges.filter((p) => isBioOrAdoptive(p.qualifier)).map((p) => p.id).sort(cmpId);
  const stepParents = parentEdges.filter((p) => !isBioOrAdoptive(p.qualifier)).map((p) => p.id).sort(cmpId);

  const children = graph.children(focusId).filter((c) => graph.byId.has(c.id)).map((c) => c.id).sort(order);
  const childQualifier = new Map(
    graph.children(focusId).map((c) => [c.id, norm(c.qualifier)]),
  );

  // Siblings are DERIVED (shared parents) — graph.siblings already carries
  // the full/half/step kind, which the portrait must not re-guess.
  const siblings = graph.siblings(focusId).filter((s) => graph.byId.has(s.id));
  const siblingKind = new Map(siblings.map((s) => [s.id, s.kind]));
  const siblingIds = siblings.map((s) => s.id).sort(order);

  /* ── Where each of them sits ─────────────────────────────────────────── */
  const at = new Map();     // id -> { x, y }
  const role = new Map();   // id -> role
  const place = (id, x, y, r) => { if (!at.has(id)) { at.set(id, { x, y }); role.set(id, r); } };

  place(focusId, 0, 0, 'focus');
  // Beyond MAX_ARM, a partner arm stops reaching further out and starts a
  // new row instead — for the ordinary case (four or fewer) this is exactly
  // the single straight line it always was; row/col both collapse to the
  // old i+1 formula.
  const currentCols = armCols(current.length);
  current.forEach((id, i) => {
    const { col, row } = gridRC(i, currentCols);
    place(id, MATE * (col + 1), row * ROW_STACK, 'partner');
  });
  // A former partner sits on the other side, so the two sides of a life read
  // as two sides rather than a queue.
  const formerCols = armCols(formers.length);
  formers.forEach((id, i) => {
    const { col, row } = gridRC(i, formerCols);
    place(id, -EX - MATE * col, row * ROW_STACK, 'former-partner');
  });

  // Parents: centred over the focus as a couple. Step-parents stand just
  // outside them — present, and visibly not the same relationship.
  const parentSpan = bloodParents.length > 1 ? MATE : 0;
  bloodParents.forEach((id, i) => {
    const off = bloodParents.length > 1 ? (i - (bloodParents.length - 1) / 2) * parentSpan : 0;
    place(id, off, -GEN, 'parent');
  });
  stepParents.forEach((id, i) => {
    const edge = (bloodParents.length > 1 ? MATE / 2 : 0) + MATE * (i + 1);
    place(id, edge, -GEN, 'step-parent');
  });

  /* Children hang under the couple they actually belong to. A child of the
   * focus and a current partner sits between them; a child of a former
   * partner sits over on that side; a child with no other recorded parent
   * sits under the focus alone. Nothing is centred for tidiness at the cost
   * of saying the wrong thing about who the parents are. */
  const otherParentOf = new Map();
  for (const cid of children) {
    const ps = graph.parents(cid).filter((p) => p.id !== focusId && graph.byId.has(p.id)).map((p) => p.id);
    const mate = ps.find((id) => at.has(id) && (role.get(id) === 'partner' || role.get(id) === 'former-partner'));
    otherParentOf.set(cid, mate || null);
  }
  const groups = new Map(); // mate id (or '') -> child ids
  for (const cid of children) {
    const k = otherParentOf.get(cid) || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(cid);
  }
  /* Each group WANTS to sit under its own couple; two groups wanting the
   * same stretch of row would otherwise overlap (a child of a former partner
   * and a child of the current one both reaching for the middle). So every
   * GROUP — not every child — asks for a block of space, the blocks are
   * separated left to right, and the whole run is re-centred on what it
   * collectively asked for — near the right parents, and never one
   * portrait on top of another. A group past MAX_KID_ROW wraps into further
   * rows under the SAME block rather than widening it, so a big family
   * still reads as one group instead of spilling into its neighbour's
   * space; for a group at or under that size this is exactly the old
   * single centred row. */
  const blocks = [];
  for (const [mate, kids] of groups) {
    const sorted = kids.slice().sort(order);
    const cols = Math.min(sorted.length, MAX_KID_ROW);
    const anchorX = mate ? at.get(mate).x / 2 : 0;
    blocks.push({ kids: sorted, cols, anchorX, halfWidth: (cols * KID_GAP) / 2 });
  }
  blocks.sort((a, b) => a.anchorX - b.anchorX || cmpId(a.kids[0], b.kids[0]));
  let prevRight = -Infinity, drift = 0;
  for (const b of blocks) {
    const wantLeft = b.anchorX - b.halfWidth;
    const left = Math.max(wantLeft, prevRight);
    b.centerX = left + b.halfWidth;
    prevRight = left + b.halfWidth * 2;
    drift += b.anchorX - b.centerX;
  }
  const recentre = blocks.length ? drift / blocks.length : 0;
  for (const b of blocks) {
    const cx = b.centerX + recentre;
    b.kids.forEach((cid, i) => {
      const { col, row } = gridRC(i, b.cols);
      const colsInRow = Math.min(b.kids.length - row * b.cols, b.cols);
      place(cid, cx + (col - (colsInRow - 1) / 2) * KID_GAP, GEN + row * ROW_STACK, 'child');
    });
  }

  // Siblings out to the sides on a shallow arc, alternating so the group
  // stays balanced around the person it belongs to. They start clear of
  // whichever partner arm reaches furthest — bounded by MAX_ARM now, not by
  // the raw partner count, so a large blended family doesn't push the
  // siblings an ever-further, ever-thinner distance from the person they
  // actually belong to.
  const armReach = (cols) => cols * MATE;
  const partnerReach = Math.max(armReach(currentCols), formers.length ? EX + MATE * (formerCols - 1) : 0, MATE);
  const sideOf = [[], []]; // 0: left, 1: right — alternating keeps both sides balanced
  siblingIds.forEach((id, i) => sideOf[i % 2].push(id));
  sideOf.forEach((list, sideIdx) => {
    const side = sideIdx === 0 ? -1 : 1;
    const cols = armCols(list.length);
    list.forEach((id, i) => {
      const { col, row } = gridRC(i, cols);
      const x = side * (partnerReach + SIB_GAP * (col + 1));
      const y = -SIB_LIFT - ROW_STACK * row;
      place(id, x, y, 'sibling');
    });
  });

  /* ── The frame Canopy's renderer draws ───────────────────────────────── */
  const nodes = new Map();
  const units = [];
  const unitFor = (ids) => {
    const memberIds = ids.filter((id) => at.has(id));
    if (!memberIds.length) return null;
    const xs = memberIds.map((id) => at.get(id).x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const u = {
      id: `p:${memberIds.join('+')}`,
      memberIds,
      anchorMemberIds: [],
      offsets: new Map(memberIds.map((id) => [id, at.get(id).x - cx])),
      labelHalfWidths: new Map(memberIds.map((id) => [id, NODE_R])),
      row: 0,
      x: cx,
      halfW: NODE_R,
      band: 'kin',
      kind: memberIds.length > 1 ? 'pod' : 'single',
      anchorId: memberIds[0],
      anchorOnly: false,
    };
    units.push(u);
    return u;
  };
  // One unit per person, plus real pods for the couples — so a couple gets
  // its capsule and a descent leaves from between them, exactly as it does
  // on the map.
  const podded = new Set();
  const podOf = new Map();
  for (const id of current) {
    const u = unitFor([focusId, id]);
    if (u) { podded.add(focusId); podded.add(id); podOf.set(id, u); podOf.set(focusId, u); }
    break; // the pod is the first current partner; further ones stand alone
  }
  const parentUnion = bloodParents.length > 1 ? partnerStatus(bloodParents[0], bloodParents[1]) : null;
  if (parentUnion) {
    const u = unitFor([bloodParents[0], bloodParents[1]]);
    if (u) for (const id of [bloodParents[0], bloodParents[1]]) { podded.add(id); podOf.set(id, u); }
  }
  const soloOf = new Map();
  for (const [id] of at) {
    if (podded.has(id)) continue;
    const u = unitFor([id]);
    if (u) soloOf.set(id, u);
  }

  for (const [id, pos] of at) {
    nodes.set(id, {
      id,
      unitId: (podOf.get(id) || soloOf.get(id))?.id ?? `p:${id}`,
      x: pos.x, y: pos.y,
      rowBaselineY: pos.y, anchorY: pos.y,
      row: 0, rank: 0,
      band: id === focusId ? 'hearth' : 'kin',
      r: id === focusId ? NODE_R * 1.16 : NODE_R,
      labelHalfWidth: NODE_R,
      isFocus: id === focusId,
      satellite: false,
      role: role.get(id),
    });
  }

  const bonds = [];
  const unitOf = (id) => podOf.get(id) || soloOf.get(id);
  /* Which unit a descent hangs from — the one rule the whole composition's
   * truthfulness rests on. A connector may leave from a WHOLE unit only when
   * the parents it names are exactly that unit's membership; anything else
   * gets an anchor-only junction on precisely those people. Without the
   * membership test, a child of one member of a couple would appear to
   * descend from the couple — drawing a parent edge that does not exist. */
  const junctions = new Map();
  const anchorUnit = (ids) => {
    const inPortrait = ids.filter((id) => at.has(id));
    if (!inPortrait.length) return null;
    const shared = unitOf(inPortrait[0]);
    if (shared
      && shared.memberIds.length === inPortrait.length
      && inPortrait.every((id) => unitOf(id) === shared)) return shared.id;
    const key = inPortrait.join('+');
    if (junctions.has(key)) return junctions.get(key);
    const u = unitFor(inPortrait);
    if (!u) return null;
    u.id = `j:${key}`;
    u.anchorOnly = true;
    u.anchorMemberIds = inPortrait;
    u.memberIds = [];
    junctions.set(key, u.id);
    return u.id;
  };

  for (const id of current) bonds.push({ kind: 'union', a: focusId, b: id, status: 'current' });
  for (const id of formers) bonds.push({ kind: 'union', a: focusId, b: id, status: 'former' });
  if (parentUnion) bonds.push({ kind: 'union', a: bloodParents[0], b: bloodParents[1], status: parentUnion === 'former' ? 'former' : 'current' });

  // The focus, and every sibling, descends from the parents they actually
  // have — grouped by qualifier, so a step-parent's line is a step line.
  const descentsFor = (childId) => {
    const byQ = new Map();
    for (const p of graph.parents(childId)) {
      if (!at.has(p.id)) continue;
      const q = norm(p.qualifier);
      if (!byQ.has(q)) byQ.set(q, []);
      byQ.get(q).push(p.id);
    }
    for (const [q, ids] of [...byQ.entries()].sort((a, b) => cmpId(a[0], b[0]))) {
      const parentUnit = anchorUnit(ids.sort(cmpId));
      if (parentUnit) bonds.push({ kind: 'descent', parentUnit, child: childId, qualifier: q });
    }
  };
  descentsFor(focusId);
  for (const id of siblingIds) descentsFor(id);
  for (const cid of children) {
    const mate = otherParentOf.get(cid);
    const parents = mate ? [focusId, mate].sort(cmpId) : [focusId];
    const parentUnit = anchorUnit(parents);
    if (parentUnit) bonds.push({ kind: 'descent', parentUnit, child: cid, qualifier: childQualifier.get(cid) || 'biological' });
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const xs = [...at.values()].map((p) => p.x), ys = [...at.values()].map((p) => p.y);
  return {
    focusId,
    nodes,
    units,
    unitById,
    bonds,
    roles: role,
    siblingKind,
    bounds: {
      minX: Math.min(...xs) - NODE_R * 2, maxX: Math.max(...xs) + NODE_R * 2,
      minY: Math.min(...ys) - NODE_R * 2, maxY: Math.max(...ys) + NODE_R * 2,
    },
    count: at.size,
  };
}
