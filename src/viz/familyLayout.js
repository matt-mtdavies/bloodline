import { sortChildren } from '../data/graph.js';

/*
 * Family-structured layout for the ORGANIC bubble tree.
 *
 * The organic view is a force simulation, and left to itself d3-force only
 * knows "these two are linked, keep them roughly this far apart" — it has no
 * idea which direction a partner belongs in, or that a child belongs *under*
 * its parents rather than beside them. That's why the untouched layout kept
 * stacking couples vertically and scattering children wherever there happened
 * to be room (real user report, with a screenshot: "There is a real problem
 * with the tree display").
 *
 * This module turns the genealogy into an explicit STRUCTURE — partner pods
 * and sibling groups, with a deterministic left-to-right order inside each —
 * which BubbleTree then applies as extra per-tick forces. Deliberately forces
 * rather than fixed positions (the chart view already owns fixed positions,
 * see chartLayout.js): the simulation still breathes, still collides, still
 * eases between arrangements, so the tree stays alive rather than snapping to
 * a grid.
 *
 * The structure is derived once per graph/visible-set change (NOT per tick) —
 * see rebuildFamilyStructure's call sites in BubbleTree — because it depends
 * only on the data, never on where anybody currently sits.
 *
 * Both exports are pure and unit-tested (tests/familyLayout.test.mjs).
 */

// Centre-to-centre spacing between two people in a partner pod.
//
// MUST stay at or above twice BubbleTree's collision radius (2 × COLLIDE =
// 140). Below that, the collision force is permanently unsatisfied by the
// horizontal spacing this rule asks for, and — since the pod pins the X
// offsets — the only direction left for it to push a couple apart is
// VERTICALLY. That was the real reason partners still settled visibly tilted
// even once they shared a generation row: not a weak pod force, but collision
// resolving a gap it was never given room for.
export const POD_GAP = 146;
// Centre-to-centre spacing between adjacent siblings under the same parents.
// Chosen to sit near where the tree's own charge repulsion already wants to
// hold two same-row bubbles, so the even-distribution target cooperates with
// the organic forces instead of permanently straining against them — a much
// tighter gap would settle unevenly wherever charge won a local fight.
export const SIB_GAP = 210;

const isFormer = (status) => status === 'former';

/*
 * buildFamilyStructure(graph, isVisible) → { pods, podOf, childGroups }
 *
 *   pods:        [{ ids: [...], offset: Map<id, number> }] — one entry per
 *                partner-connected group of 2+ visible people. `offset` is the
 *                person's target X displacement from the pod's centre, in
 *                multiples of POD_GAP: the anchor sits at 0, current partners
 *                fan out to the right, former partners to the left. Ordering
 *                is deterministic (never derived from current positions), so
 *                a pod never churns left/right between rebuilds.
 *   podOf:       Map<id, pod> for the members of those pods.
 *   childGroups: [{ parents: [...], kids: [...] }] — every visible sibling set
 *                that shares the same visible parent set, kids in the app's
 *                own display order (graph.js's sortChildren: biological/
 *                adoptive before step, then oldest first).
 */
export function buildFamilyStructure(graph, isVisible) {
  // ── Partner pods (union-find over visible partner edges, any status) ──────
  // Any status on purpose: the ask was explicitly "all partners AND former
  // partners displayed on the same horizontal line". A former partner is
  // still a co-parent and still belongs on the couple's row.
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const partnered = new Set();
  for (const p of graph.people) {
    if (!isVisible(p.id)) continue;
    for (const pt of graph.partners(p.id)) {
      if (!isVisible(pt.id)) continue;
      if (!parent.has(p.id)) parent.set(p.id, p.id);
      if (!parent.has(pt.id)) parent.set(pt.id, pt.id);
      union(p.id, pt.id);
      partnered.add(p.id);
      partnered.add(pt.id);
    }
  }

  const members = new Map(); // root → [ids]
  for (const id of partnered) {
    const root = find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  }

  const pods = [];
  const podOf = new Map();
  for (const ids of members.values()) {
    if (ids.length < 2) continue;
    // The anchor is whoever holds the pod together — the person with the most
    // partners in it (the hub of a 3+ pod), tie-broken by id so the choice is
    // stable across rebuilds rather than dependent on iteration order.
    const partnerCountIn = (id) =>
      graph.partners(id).filter((pt) => ids.includes(pt.id)).length;
    const ordered = [...ids].sort((a, b) => {
      const d = partnerCountIn(b) - partnerCountIn(a);
      return d !== 0 ? d : String(a).localeCompare(String(b));
    });
    const anchor = ordered[0];
    const anchorPartners = new Map(
      graph.partners(anchor).map((pt) => [pt.id, pt.status]),
    );
    // Current partners to the right, former partners to the left — the same
    // reading order the profile itself uses, and it keeps a remarried person
    // visually between the two chapters of their life. Anyone reached only
    // through another member (a 3+ chain) trails on the right.
    const right = [];
    const left = [];
    for (const id of ordered.slice(1)) {
      (isFormer(anchorPartners.get(id)) ? left : right).push(id);
    }
    const offset = new Map([[anchor, 0]]);
    right.forEach((id, i) => offset.set(id, i + 1));
    left.forEach((id, i) => offset.set(id, -(i + 1)));
    // Re-centre so the pod's own midpoint is the thing that gets positioned,
    // not the anchor — otherwise a pod with two exes and no current partner
    // hangs entirely off to one side of wherever it's pulled.
    const mid = (Math.max(...offset.values()) + Math.min(...offset.values())) / 2;
    for (const [id, o] of offset) offset.set(id, o - mid);

    const pod = { ids: [...ids], offset };
    pods.push(pod);
    for (const id of ids) podOf.set(id, pod);
  }

  // ── Sibling groups (children sharing the same visible parent set) ─────────
  const groups = new Map();
  for (const person of graph.people) {
    if (!isVisible(person.id)) continue;
    const parents = graph.parents(person.id).filter((p) => isVisible(p.id));
    if (parents.length === 0) continue;
    const key = parents.map((p) => p.id).sort().join('|');
    if (!groups.has(key)) groups.set(key, { parents: parents.map((p) => p.id), kids: [] });
    groups.get(key).kids.push(person.id);
  }
  const childGroups = [];
  for (const grp of groups.values()) {
    // Ordered by the app's own Children convention so the tree agrees with
    // every list that shows the same siblings — and, being data-derived, the
    // order never flips as the simulation moves people around.
    const kids = sortChildren(
      grp.kids.map((id) => ({ id, qualifier: qualifierOf(graph, grp.parents[0], id) })),
      graph.byId,
    ).map((c) => c.id);
    childGroups.push({ parents: grp.parents, kids });
  }

  return { pods, podOf, childGroups };
}

function qualifierOf(graph, parentId, childId) {
  return graph.parents(childId).find((p) => p.id === parentId)?.qualifier || 'biological';
}

// Bounded because a malformed/cyclic edge could otherwise keep finding a
// reason to push someone down forever. Rows only ever increase below, so a
// well-formed family converges in far fewer passes than this.
const MAX_ROW_PASSES = 12;

/*
 * computeLayoutRows(graph, structure, isVisible, gen) → Map<personId, row>
 *
 * The generation row each visible person should sit on FOR LAYOUT — the whole
 * pod on one row, and every descendant pushed below whatever their parents
 * ended up on.
 *
 * `computeGenerations` (graph.js) deliberately excludes former partners when
 * it levels couples, and for good reason: an ex from another branch can have
 * deeper ancestry, and dragging their generation around cascades into
 * relationship labels and chart rows for people who have nothing to do with
 * them. But that leaves a former partner sitting a row off their own couple —
 * reported directly, with a screenshot: "the former partner... should be at
 * the level as the current couple (where possible)". Worse, an off-row pod
 * member makes the couple capsule diagonal, which drags the child line's
 * anchor out from under the couple with it.
 *
 * Doing the levelling HERE keeps the two concerns apart: this is a layout-only
 * row, the stored `gen` (labels, chart rows, everything else) is untouched —
 * the same distinction BubbleTree's own `layoutGen` already drew, just applied
 * to whole pods instead of only childless in-laws.
 *
 * Two rules, alternated until stable:
 *   (a) every member of a pod shares the pod's deepest row;
 *   (b) every child sits at least one row below all of their visible parents.
 * Rows only ever move DOWN, so this can't oscillate, and (b) running after (a)
 * is what carries a levelled couple's shift through to their children — the
 * other half of the same report ("Jessie and Amie should be on a similar
 * horizontal plane as Matthew and Jason"): once a step-parent is levelled onto
 * their partner's row, both sets of children land on the row below together.
 */
export function computeLayoutRows(graph, structure, isVisible, gen) {
  const row = new Map();
  for (const p of graph.people) {
    if (isVisible(p.id)) row.set(p.id, gen.get(p.id) ?? 0);
  }

  for (let pass = 0; pass < MAX_ROW_PASSES; pass++) {
    let changed = false;

    for (const pod of structure.pods) {
      const live = pod.ids.filter((id) => row.has(id));
      if (live.length < 2) continue;
      const level = Math.max(...live.map((id) => row.get(id)));
      for (const id of live) {
        if (row.get(id) !== level) { row.set(id, level); changed = true; }
      }
    }

    for (const grp of structure.childGroups) {
      const parentRows = grp.parents.filter((id) => row.has(id)).map((id) => row.get(id));
      if (parentRows.length === 0) continue;
      const need = Math.max(...parentRows) + 1;
      for (const kid of grp.kids) {
        if (row.has(kid) && row.get(kid) < need) { row.set(kid, need); changed = true; }
      }
    }

    if (!changed) break;
  }
  return row;
}

/*
 * applyFamilyForces(structure, nodeById, alpha, opts) — the per-tick half.
 *
 * Three structural rules, each a gentle velocity nudge scaled by the
 * simulation's own alpha so they fade out as the layout settles (exactly how
 * d3-force's built-in forces behave), and each written so a correctly-placed
 * node is left alone rather than continually re-pushed:
 *
 *   1. A pod's members share one Y and sit at their assigned X offsets —
 *      partners and former partners on the same horizontal line.
 *   2. Each sibling set is centred under its parents' midpoint, spread evenly
 *      across it, and levelled onto one row — so children hang below their
 *      parents rather than wandering off, and siblings read as a rank.
 *   3. Parents are held above their children. (The Y bands already aim for
 *      this; this only corrects pairs that are actually inverted right now.)
 *
 * Nodes pinned by a manual drag (fx/fy set) are repositioned by the
 * simulation's own tick regardless of velocity, so this never fights a
 * deliberately-placed bubble.
 */
export function applyFamilyForces(structure, nodeById, alpha, opts = {}) {
  const {
    podGap = POD_GAP,
    sibGap = SIB_GAP,
    podStrength = 1,
    // Sharing one horizontal line is the hard requirement of the two ("all
    // partners and former partners displayed on the same horizontal line"),
    // while the sideways spacing can flex a little under crowding — so the
    // vertical half of the pod rule pulls harder than the horizontal half.
    podYStrength = 1.6,
    childStrength = 0.34,
    // Deliberately well under podStrength. A married person is pulled by both
    // rules — their partners want them on the couple's line, their brothers
    // and sisters want them on the sibling row — and when those disagree the
    // couple has to win: the ask was partners on the SAME horizontal line but
    // siblings only on a SIMILAR plane, so this is the one that gives.
    siblingRowStrength = 0.2,
    parentGap = 120,
    parentStrength = 0.3,
  } = opts;

  // ── 1. Pods: one row, side by side ───────────────────────────────────────
  for (const pod of structure.pods) {
    const live = pod.ids.map((id) => nodeById.get(id)).filter(Boolean);
    if (live.length < 2) continue;
    const cx = live.reduce((s, n) => s + n.x, 0) / live.length;
    const cy = live.reduce((s, n) => s + n.y, 0) / live.length;
    for (const n of live) {
      const targetX = cx + (pod.offset.get(n.id) ?? 0) * podGap;
      n.vx += (targetX - n.x) * podStrength * alpha;
      n.vy += (cy - n.y) * podYStrength * alpha;
    }
  }

  // ── 2. Children centred and evenly spread under their parents ────────────
  // Slot width is per-child rather than a flat gap: a sibling who has partners
  // of their own occupies their whole pod's width, so the pods either side of
  // them aren't laid straight on top of each other.
  //
  // A sibling who is in a pod is moved by translating THEIR WHOLE POD, not by
  // pulling them alone. Pulling the individual would set this force directly
  // against rule 1 for the same person — the two would spend the whole
  // simulation tugging that one bubble between their partner and their
  // parents, and (rule 1 being the stronger of the two) siblings ended up
  // spaced by whoever won each local fight rather than evenly. Translating
  // rigidly lets a married sibling slide into their slot with their partner
  // in tow, which is what the arrangement is supposed to look like anyway.
  for (const grp of structure.childGroups) {
    const parents = grp.parents.map((id) => nodeById.get(id)).filter(Boolean);
    if (parents.length === 0) continue;
    const kids = grp.kids.map((id) => nodeById.get(id)).filter(Boolean);
    if (kids.length === 0) continue;
    const midX = parents.reduce((s, n) => s + n.x, 0) / parents.length;
    const widths = kids.map((n) => {
      const pod = structure.podOf.get(n.id);
      return pod ? Math.max(sibGap, pod.ids.length * podGap) : sibGap;
    });
    const total = widths.reduce((s, w) => s + w, 0);
    // Siblings also share one row, so a set of brothers and sisters reads as a
    // rank rather than a staircase. Levelled against their own mean Y rather
    // than a fixed drop below the parents: how far down the row sits is the
    // generation bands' business, and pinning it here would just give those
    // two forces something to argue about.
    const rowY = kids.reduce((s, n) => s + n.y, 0) / kids.length;
    let cursor = -total / 2;
    for (let i = 0; i < kids.length; i++) {
      const targetX = midX + cursor + widths[i] / 2;
      cursor += widths[i];
      const shiftX = (targetX - kids[i].x) * childStrength * alpha;
      const shiftY = (rowY - kids[i].y) * siblingRowStrength * alpha;
      const pod = structure.podOf.get(kids[i].id);
      if (pod) {
        for (const mid of pod.ids) {
          const m = nodeById.get(mid);
          if (m) m.vx += shiftX;
        }
      } else {
        kids[i].vx += shiftX;
      }
      // The row levelling is applied to the sibling alone even when they're
      // in a pod — dragging their partner's whole pod vertically would haul
      // that partner off their own generation band, and rule 1 re-flattens
      // the pod around them anyway, one row down from wherever it lands.
      kids[i].vy += shiftY;
    }
  }

  // ── 3. Parents above children ────────────────────────────────────────────
  for (const grp of structure.childGroups) {
    for (const pid of grp.parents) {
      const parent = nodeById.get(pid);
      if (!parent) continue;
      for (const cid of grp.kids) {
        const child = nodeById.get(cid);
        if (!child) continue;
        const violation = (parent.y + parentGap) - child.y; // > 0 → parent too low
        if (violation <= 0) continue;
        const push = violation * parentStrength * alpha;
        parent.vy -= push;
        child.vy += push;
      }
    }
  }
}
