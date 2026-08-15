/*
 * The Focus Layer planner — pure, deterministic, and deliberately small.
 *
 * This is NOT a whole-tree layout. It plans ONE person's family: the people
 * whose relationship to the selected person you can name in a word. That
 * restriction is the entire point. Every invariant we could not hold at 250
 * nodes (parents strictly above children, partners level and adjacent, no
 * overlaps, no crossings) is trivially holdable at twenty, so this module gets
 * to make positional GUARANTEES rather than apply positional pressures.
 *
 *   planFocusFamily({ graph, personId })  → { nodes, ties, bundles, bounds }
 *   planFocusView({ graph, personId, viewport })  → the same, plus a camera
 *
 * The guarantees tests/focusLayout.test.mjs pins:
 *   • the selected person is at world origin (0, 0);
 *   • every parent's row is strictly above every one of their children's;
 *   • current partners share the selected person's row, adjacent, at POD;
 *   • a former partner sits ABOVE their hub's row, offset 10°–45° to the
 *     side, on the opposite side to any current partner;
 *   • siblings share the selected person's row in birth order;
 *   • children are centred beneath the union that produced them;
 *   • nobody is placed twice, whatever route the graph offers to them;
 *   • no two bubbles overlap;
 *   • identical input → byte-identical output (no Math.random; total sorts).
 *
 * Two separate constraints govern how much of a family we show, and they are
 * deliberately NOT the same knob:
 *   capacity   — how many people may be in the focus layer at all (shed the
 *                outermost ring when a family exceeds it);
 *   legibility — how small a bubble may ever be drawn (never below
 *                MIN_DIAMETER; if the family cannot fit at that size the view
 *                becomes pannable rather than shrinking past the floor).
 */

import { relationLabel } from '../../data/graph.js';

/** Vertical distance between generation rows. Four generations plus their
 *  name plates have to clear a laptop's 900px, so this is as tall as the
 *  composition can afford while every bubble still holds MIN_DIAMETER. */
export const ROW = 240;
/** Centre-to-centre spacing between two people inside one couple pod. */
export const POD = 200;
/** Minimum centre-to-centre spacing between neighbours sharing a row. */
export const GAP = 235;
/** A former partner is raised this fraction of a row above their hub … */
export const EX_RISE = 0.46;
/** … and set this far to the side. Together: ~22°, inside the 10–45° band. */
export const EX_REACH = 340;
/** Edge-to-edge clearance the row de-overlap pass enforces. */
export const CLEARANCE = 34;
/** …but no two neighbours on a row ever sit closer than this centre-to-centre,
 *  whatever their radii, because their NAMES need the room. Two small
 *  grandparent bubbles cleared each other comfortably and their labels still
 *  overlapped, which is the only collision a reader actually notices. Equal to
 *  POD, so a couple is exactly at the limit and everything else is wider. */
export const MIN_NEIGHBOUR = 200;
/** Vertical room a name plate needs below its bubble, counted into the bounds
 *  so the camera never crops the bottom row's names. */
export const PLATE_ROOM = 58;
/** The legibility floor: a focus bubble is never drawn smaller than this.
 *  Arrived at by arithmetic rather than taste — four generations at ROW apart,
 *  plus name plates, need about 850 world units of height, and a 900px laptop
 *  minus chrome and padding leaves roughly 760 of them. 76px is what that
 *  affords while still keeping all four generations on screen at once, and it
 *  is still nearly twice the size a bubble ends up at in the dense tree. */
export const MIN_DIAMETER = 76;
/** How many people the focus layer may hold, by viewport width. A phone simply
 *  cannot hold four generations of a wide family at a legible size, so it sheds
 *  the outermost ring earlier rather than asking for a lot of panning. */
export const CAPACITY = { phone: 10, desktop: 40 };

/** Bubble radii by role, in world units. Weight falls off with distance from
 *  the selected person — that gradient is what makes the arrangement readable
 *  in one glance instead of requiring a trace. */
export const RADIUS = {
  self: 66,
  partner: 58,
  ex: 50,
  sibling: 54,
  child: 56,
  parent: 56,
  grandparent: 48,
};

/** Choreography rings — the order the family arrives in, outward from the
 *  selected person. The former-partner TIE is drawn last (see the tie's own
 *  ring) even though the bubble itself arrives with the siblings. */
export const RING = {
  self: 0,
  partner: 1,
  child: 2,
  sibling: 3,
  ex: 3,
  parent: 4,
  grandparent: 5,
};

const isFormer = (status) => status === 'former' || status === 'divorced';

/* Every sort in this file ends in an id comparison so two people with
 * identical data can never swap places between runs. */
const byBirthThenId = (byId) => (a, b) => {
  const pa = byId.get(a), pb = byId.get(b);
  const ba = pa?.birth_date ?? null, bb = pb?.birth_date ?? null;
  if (ba && bb && ba !== bb) return ba < bb ? -1 : 1;
  if (ba && !bb) return -1;
  if (!ba && bb) return 1;
  return String(a).localeCompare(String(b));
};

/**
 * Push apart anything on one row that would overlap, then slide the row back
 * so its midpoint is unchanged. A uniform shift preserves every gap the
 * forward pass just established, so this can never reintroduce an overlap.
 */
function deOverlapRow(items) {
  if (items.length < 2) return;
  items.sort((a, b) => a.x - b.x || String(a.id).localeCompare(String(b.id)));
  const before = (items[0].x + items[items.length - 1].x) / 2;
  for (let i = 1; i < items.length; i++) {
    const need = Math.max(items[i - 1].r + items[i].r + CLEARANCE, MIN_NEIGHBOUR);
    if (items[i].x - items[i - 1].x < need) items[i].x = items[i - 1].x + need;
  }
  const after = (items[0].x + items[items.length - 1].x) / 2;
  const shift = before - after;
  for (const it of items) it.x += shift;
}

/**
 * Place child groups on one row. Each group WANTS its own union's x; groups are
 * packed rigidly in that order so a group is never torn apart to make room, and
 * the whole set is then translated by the average deviation so the row stays
 * centred. When there is room (the common case) every group lands exactly on
 * its union; when there is not, groups slide as units and their trunks lean.
 */
function packChildGroups(groups) {
  const sorted = groups.slice().sort((a, b) => a.want - b.want || String(a.key).localeCompare(String(b.key)));
  for (let i = 0; i < sorted.length; i++) sorted[i].x = sorted[i].want;
  for (let i = 1; i < sorted.length; i++) {
    const need = Math.max(sorted[i - 1].half + sorted[i].half + CLEARANCE, MIN_NEIGHBOUR);
    if (sorted[i].x - sorted[i - 1].x < need) sorted[i].x = sorted[i - 1].x + need;
  }
  const drift = sorted.reduce((s, g) => s + (g.x - g.want), 0) / (sorted.length || 1);
  for (const g of sorted) g.x -= drift;
  return sorted;
}

/** The union point two co-parents' children hang from: the true midpoint
 *  between them. For a couple sharing a row that is simply the point on the
 *  partner tie between them; for a FORMER partner — who is raised off the row —
 *  it lands on the dashed tie itself, so their children visibly descend from
 *  that relationship rather than from open space beside it. */
function unionPoint(a, b) {
  if (!b) return { x: a.x, y: a.y };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Plan one person's family.
 *
 * @param rings 5 = through grandparents, 4 = stop at parents. Capacity sheds
 *              the outermost ring rather than shrinking anybody.
 */
export function planFocusFamily({ graph, personId, rings = 5 }) {
  const byId = graph.byId;
  const self = byId.get(personId);
  if (!self) return { nodes: [], ties: [], bundles: [], bounds: null, rings };

  const nodes = [];
  const ties = [];
  const bundles = [];
  const nodeById = new Map();

  /* ── Claim first, place second ────────────────────────────────────────────
   * A real graph offers more than one route to the same person: a grandmother
   * who also recorded herself as a parent is both "parent" and, through the
   * derived-sibling rule, her own child's "sibling". Everybody is therefore
   * claimed exactly once, closest relationship winning, BEFORE any coordinate
   * is computed — otherwise the same person is planted on two rows at once.
   */
  const taken = new Set([personId]);
  const claim = (ids) => {
    const out = [];
    for (const id of ids) {
      if (!byId.has(id) || taken.has(id)) continue;
      taken.add(id);
      out.push(id);
    }
    return out;
  };

  const partnerEdges = graph.partners(personId);
  const currentIds = claim(partnerEdges.filter((p) => !isFormer(p.status))
    .map((p) => p.id).sort(byBirthThenId(byId)));
  const formerIds = claim(partnerEdges.filter((p) => isFormer(p.status))
    .map((p) => p.id).sort(byBirthThenId(byId)));
  const childEdges = graph.children(personId)
    .filter((c) => byId.has(c.id) && !taken.has(c.id));
  claim(childEdges.map((c) => c.id));
  const parentIds = claim(graph.parents(personId).map((p) => p.id).sort(byBirthThenId(byId)));
  const sibEdges = graph.siblings(personId).filter((s) => byId.has(s.id) && !taken.has(s.id));
  claim(sibEdges.map((s) => s.id));

  const put = (id, role, x, y, extra = {}) => {
    const node = {
      id,
      person: byId.get(id),
      role,
      x,
      y,
      r: RADIUS[role],
      ring: RING[role],
      label: role === 'self' ? 'You' : safeLabel(graph, personId, id),
      qualifier: 'biological',
      ...extra,
    };
    nodes.push(node);
    nodeById.set(id, node);
    return node;
  };

  /* ── Row 0: the selected person, their partners, their siblings ───────── */
  const selfNode = put(personId, 'self', 0, 0);

  // Current partners sit level and adjacent — one shape, two people.
  const currentNodes = currentIds.map((id, i) => put(id, 'partner', POD * (i + 1), 0));

  // A former partner is raised off the row and set to the OPPOSITE side from
  // any current partner. The geometry alone says the relationship ended; no
  // label required. With nobody current they take the left, and their own
  // children then hang left of centre, keeping the two chapters apart.
  const exNodes = formerIds.map((id, i) => put(
    id, 'ex', -(EX_REACH + i * 90), -ROW * (EX_RISE + i * 0.14),
  ));

  // Siblings flank the pod in birth order: born before the selected person to
  // the left, after to the right, so the row reads chronologically across.
  const selfBirth = self.birth_date ?? null;
  const older = [], younger = [];
  for (const id of sibEdges.map((s) => s.id).sort(byBirthThenId(byId))) {
    const b = byId.get(id)?.birth_date ?? null;
    const isOlder = b && selfBirth ? b < selfBirth : older.length <= younger.length;
    (isOlder ? older : younger).push(id);
  }
  const podLeft = Math.min(0, ...currentNodes.map((n) => n.x));
  const podRight = Math.max(0, ...currentNodes.map((n) => n.x));
  const kindOf = new Map(sibEdges.map((s) => [s.id, s.kind]));
  const sibNode = (id, x) => put(id, 'sibling', x, 0, {
    qualifier: kindOf.get(id) === 'step' ? 'step' : 'biological',
  });
  const sibNodes = [
    // nearest-first outward, so the eldest ends up furthest left
    ...older.slice().reverse().map((id, i) => sibNode(id, podLeft - GAP * (i + 1))),
    ...younger.map((id, i) => sibNode(id, podRight + GAP * (i + 1))),
  ];

  ties.push(...currentNodes.map((n) => ({ kind: 'current', a: selfNode, b: n, ring: RING.partner })));
  // Drawn last of everything, deliberately.
  ties.push(...exNodes.map((n) => ({ kind: 'former', a: selfNode, b: n, ring: 6 })));

  /* ── Row +1: children, centred under the union that produced them ─────── */
  const partnerNodeById = new Map([...currentNodes, ...exNodes].map((n) => [n.id, n]));
  const grouped = new Map(); // co-parent id (or '') → [{id, qualifier}]
  for (const c of childEdges) {
    const others = graph.parents(c.id).filter((p) => p.id !== personId);
    const co = others.find((p) => partnerNodeById.has(p.id))?.id ?? '';
    if (!grouped.has(co)) grouped.set(co, []);
    grouped.get(co).push(c);
  }
  const groups = [...grouped.keys()].sort((a, b) => String(a).localeCompare(String(b))).map((co) => {
    const kids = grouped.get(co).slice().sort((a, b) => byBirthThenId(byId)(a.id, b.id));
    const anchor = unionPoint(selfNode, partnerNodeById.get(co) || null);
    const half = (kids.length - 1) * GAP / 2 + RADIUS.child;
    return { key: co || '·', kids, anchor, want: anchor.x, half };
  });
  for (const g of packChildGroups(groups)) {
    const span = (g.kids.length - 1) * GAP;
    const placed = g.kids.map((c, i) => put(c.id, 'child', g.x - span / 2 + i * GAP, ROW, {
      qualifier: c.qualifier || 'biological',
    }));
    bundles.push({ kind: 'descent', from: g.anchor, to: placed, junctionX: g.x, ring: RING.child });
  }

  /* ── Row -1: parents, centred over the span of the children they share ── */
  let parentNodes = [];
  if (parentIds.length) {
    const kin = [selfNode, ...sibNodes];
    const centre = (Math.min(...kin.map((n) => n.x)) + Math.max(...kin.map((n) => n.x))) / 2;
    const spread = (parentIds.length - 1) * POD;
    parentNodes = parentIds.map((id, i) => put(id, 'parent', centre - spread / 2 + i * POD, -ROW));
    deOverlapRow(parentNodes);
    if (parentNodes.length === 2) {
      ties.push({ kind: 'current', a: parentNodes[0], b: parentNodes[1], ring: RING.parent });
    }
    const brood = [selfNode, ...sibNodes].sort((a, b) => a.x - b.x);
    const xs = brood.map((n) => n.x);
    bundles.push({
      kind: 'descent',
      from: unionPoint(parentNodes[0], parentNodes[1]),
      to: brood,
      junctionX: (Math.min(...xs) + Math.max(...xs)) / 2,
      ring: RING.sibling,
    });
  }

  /* ── Row -2: grandparents, each pod centred over their own child ──────── */
  if (rings >= 5 && parentNodes.length) {
    const pods = [];
    const gpNodes = [];
    for (const p of parentNodes) {
      const gpIds = claim(graph.parents(p.id).map((g) => g.id).sort(byBirthThenId(byId)));
      if (!gpIds.length) continue;
      const spread = (gpIds.length - 1) * POD;
      const placed = gpIds.map((id, i) => put(id, 'grandparent', p.x - spread / 2 + i * POD, -ROW * 2));
      gpNodes.push(...placed);
      pods.push({ pod: placed, child: p });
    }
    deOverlapRow(gpNodes);
    for (const { pod, child } of pods) {
      if (pod.length === 2) ties.push({ kind: 'current', a: pod[0], b: pod[1], ring: RING.grandparent });
      bundles.push({
        kind: 'descent',
        from: unionPoint(pod[0], pod[1]),
        to: [child],
        junctionX: child.x,
        ring: RING.grandparent,
      });
    }
  }

  return { nodes, ties, bundles, bounds: boundsOf(nodes), rings };
}

function boundsOf(nodes) {
  if (!nodes.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + PLATE_ROOM);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function safeLabel(graph, focusId, otherId) {
  try {
    return relationLabel(graph, focusId, otherId) || 'Family';
  } catch {
    return 'Family';
  }
}

/**
 * Plan a family AND choose the camera for it.
 *
 * Capacity and legibility are answered separately and in that order: shed the
 * outermost ring if the family is simply too big to be a "focus" at all, then
 * pick a zoom that never draws a bubble below MIN_DIAMETER. When those two
 * can't both be satisfied by fitting, the view becomes pannable — shrinking
 * past the legibility floor is the one thing we never do, because a focus
 * layer you have to squint at is not a focus layer.
 */
export function planFocusView({ graph, personId, viewport, padding = 48 }) {
  const w = Math.max(1, viewport.width - padding * 2);
  const h = Math.max(1, viewport.height - padding * 2);
  const capacity = viewport.width < 700 ? CAPACITY.phone : CAPACITY.desktop;

  let plan = planFocusFamily({ graph, personId, rings: 5 });
  if (plan.nodes.length > capacity) {
    const trimmed = planFocusFamily({ graph, personId, rings: 4 });
    if (trimmed.nodes.length) {
      plan = trimmed;
      plan.trimmed = true;
    }
  }
  plan.trimmed = plan.trimmed ?? false;
  plan.capacity = capacity;

  if (!plan.bounds) {
    return { ...plan, zoom: 1, fitZoom: 1, smallestDiameter: 0, pannable: false };
  }
  const minR = Math.min(...plan.nodes.map((n) => n.r));
  const fitZoom = Math.min(1, w / plan.bounds.width, h / plan.bounds.height);
  const floorZoom = Math.min(1, MIN_DIAMETER / (2 * minR));
  const zoom = Math.max(fitZoom, floorZoom);
  return {
    ...plan,
    zoom,
    fitZoom,
    smallestDiameter: minR * 2 * zoom,
    pannable: zoom > fitZoom + 1e-6,
  };
}
