/*
 * Traditional hierarchical family chart — a *tidy descendant tree*.
 *
 * This module owns the CHART VIEW ONLY. It produces static positions for a
 * clean, org-chart-style descendant tree rooted at the focal person's most
 * senior ancestor, so generations sit on consistent rows and every parent is
 * centred over its children with no crossing lines.
 *
 * Model:
 *   • A "pod" is a couple (two cards side by side) or a single person.
 *   • Children hang below their parents' pod; siblings are grouped contiguously.
 *   • Subtree widths are computed bottom-up (Reingold–Tilford style) so siblings
 *     never overlap and a parent is centred over the span of its children.
 *
 * A pod holds at most two people, and biological/adoptive co-parents pod
 * together FIRST — computed from the parent-child rows themselves, regardless
 * of partner status — so a child's card always hangs beneath both of their
 * recorded parents. Partners who share no children pod together from partner
 * edges afterwards; anyone left over stands alone. Every relationship remains
 * fully present everywhere else in the app and in the data.
 *
 * computeChartLayout(graph, focalId) → Map<personId, {x, y}>
 * The set of positioned ids IS the chart's visible set (pos.keys()).
 */

const CARD = 92;          // card diameter (2 × BASE_RADIUS)
const COUPLE_GAP = 108;   // centre-to-centre between two spouses in a pod
const SIB_GAP = 44;       // edge-to-edge between sibling subtrees
const FAM_GAP = 110;      // edge-to-edge between separate root trees
const ROW_GAP = 240;      // vertical distance between generation rows

// Shared by computeChartLayout (canvas chart mode) and computeChartPods (the
// DOM chart-view renderer, ChartTree.jsx): everything through "pods exist and
// know their child pods" is identical for both consumers — only the geometry
// (card size, spacing, collapse) differs downstream, so that part is each
// caller's own step 6+. Extracted rather than duplicated so the two views can
// never quietly diverge on WHO belongs to which pod or WHICH pod is whose
// parent — only on how the pods are drawn.
function buildPodTree(graph, focalId) {
  const parentsOf = (id) => graph.parents(id);
  const childrenOf = (id) => graph.children(id);
  const partnersOf = (id) => graph.partners(id);
  // Both 'adoptive' (AddRelativeSheet) and 'adopted' (seed/GEDCOM data) occur
  // in real stores; the chart treats either as a bloodline-equivalent edge.
  const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';

  // ── 1-2. Visible set: the WHOLE family component reachable from the focal
  //       person via any parent, child, or partner edge — not just one
  //       "senior ancestor"'s descendants. A real, well-connected family
  //       constantly has separate ancestor lines converge through marriage
  //       (someone's daughter marries someone else's son); picking only one
  //       such line as "the" root silently dropped the OTHER line entirely —
  //       its parents, its other children, its grandchildren, all of it —
  //       even though the data was completely intact. Every blood or
  //       marriage line connected to the focal person now stays reachable;
  //       per-branch collapse (ChartTree.jsx's default-collapsed spine) is
  //       what keeps the INITIAL view small, not this. ─────────────────────
  const visible = new Set([focalId]);
  {
    const stack = [focalId];
    while (stack.length) {
      const id = stack.pop();
      const neighbors = [
        ...parentsOf(id).map((p) => p.id),
        ...childrenOf(id).map((c) => c.id),
        ...partnersOf(id).map((p) => p.id),
      ];
      for (const n of neighbors) if (!visible.has(n)) { visible.add(n); stack.push(n); }
    }
  }
  const inV = (id) => visible.has(id);
  const vParents = (id) => parentsOf(id).filter((p) => inV(p.id));
  const vChildren = (id) => childrenOf(id).filter((c) => inV(c.id));

  // ── 3. Build pods. Biological/adoptive CO-PARENT PAIRS pod together first,
  //       read straight off the parent-child rows — the exact rows the
  //       profile's "Father" / "Mother" labels render from. Partner edges get
  //       no say in this pass. Every previous version of this pairing worked
  //       through partner edges (each person picks a "best partner", couple
  //       forms if mutual) — and remarriage kept breaking it, because the
  //       current spouse and the actual co-parent compete on BOTH sides of
  //       that match and some real family shape always lost. The chart's
  //       whole contract is "biological parents shown together above their
  //       children, regardless of partner status" — so the children ARE the
  //       ground truth, and couples with no shared children pair afterwards
  //       (3b) from whatever partner edges remain. ──────────────────────────
  const pods = new Map();      // podId → pod
  const podOfPerson = new Map(); // personId → podId
  const assigned = new Set();
  const hasParents = (id) => vParents(id).length > 0;

  const makePod = (anchor, spouse) => {
    const id = 'pod_' + anchor;
    const members = spouse ? [anchor, spouse] : [anchor];
    const pod = { id, anchor, spouse: spouse || null, members, childPods: [], _sw: null, _cx: 0 };
    pods.set(id, pod);
    for (const m of members) { podOfPerson.set(m, id); assigned.add(m); }
    return pod;
  };

  // Anchor preference (shared by both pairing passes): the member with
  // bloodline parents in the tree, so up-links resolve to the right side;
  // ties broken by who has more children, then id order.
  const makeCouplePod = (a, b) => {
    let anchor = a, spouse = b;
    const aP = hasParents(a), bP = hasParents(b);
    if (bP && !aP) { anchor = b; spouse = a; }
    else if (aP === bP) {
      const ca = vChildren(a).length, cb = vChildren(b).length;
      if (cb > ca || (cb === ca && b < a)) { anchor = b; spouse = a; }
    }
    return makePod(anchor, spouse);
  };

  const statusRank = (s) => (s === 'former' ? 0 : s === 'widowed' ? 1 : 2);
  // Rank of the partner edge between two specific people; -1 when none is
  // recorded (bio co-parents often have no formal partner row at all).
  const coupleRank = (a, b) => {
    const edge = partnersOf(a).find((p) => p.id === b);
    return edge ? statusRank(edge.status) : -1;
  };

  // 3a. Tally each bio/adoptive co-parent pair by distinct shared children,
  // then let the strongest pairs claim their pods greedily. Count decides —
  // so someone's two-kid line with an ex beats their one-kid line with a new
  // partner, on whichever side of the family that happens. The partner-edge
  // rank between the two only breaks exact count ties (an intact marriage
  // with two kids outranks a two-kid ex), and the key comparison keeps even
  // that deterministic.
  const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const pairCount = new Map();
  for (const kid of visible) {
    const bioPar = [...new Set(vParents(kid).filter((p) => isBioAdopt(p.qualifier)).map((p) => p.id))];
    for (let i = 0; i < bioPar.length; i++) {
      for (let j = i + 1; j < bioPar.length; j++) {
        const k = pairKey(bioPar[i], bioPar[j]);
        pairCount.set(k, (pairCount.get(k) || 0) + 1);
      }
    }
  }
  const rankedPairs = [...pairCount.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('\u0000');
      return { a, b, count, rank: coupleRank(a, b), key };
    })
    .sort((x, y) => y.count - x.count || y.rank - x.rank || (x.key < y.key ? -1 : 1));
  for (const { a, b } of rankedPairs) {
    if (assigned.has(a) || assigned.has(b)) continue;
    makeCouplePod(a, b);
  }

  // 3b. Everyone left pairs through partner edges — couples with no shared
  // children (a remarriage, a childless couple) and singles. Mutuality (each
  // is the other's best remaining partner) keeps iteration order from
  // deciding contested cases; anyone whose partner was already claimed by a
  // bio pairing in 3a stands alone, which is exactly the point — they are
  // NOT the parent of that household's children, and drawing them into it
  // silently said they were.
  const bestFreePartner = (id) => {
    const ps = partnersOf(id).filter((p) => inV(p.id) && !assigned.has(p.id));
    if (!ps.length) return null;
    let best = ps[0], bestRank = statusRank(ps[0].status);
    for (const p of ps.slice(1)) {
      const r = statusRank(p.status);
      if (r > bestRank) { best = p; bestRank = r; }
    }
    return best.id;
  };
  for (const id of visible) {
    if (assigned.has(id)) continue;
    const partner = bestFreePartner(id);
    if (partner && bestFreePartner(partner) === id) makeCouplePod(id, partner);
    else makePod(id, null);
  }

  // ── 4. Parent → child pod links (each child attaches to one parent pod). ──
  const childPodOf = new Map(); // childPersonId → parent podId
  for (const id of visible) {
    const parEntries = vParents(id); // [{id, qualifier}]
    if (!parEntries.length) continue;
    // The chart can only draw ONE line up from a child, so it should trace
    // blood/adoption, not whichever parent happens to be in a recorded
    // couple. A step-parent's household would otherwise systematically win
    // this pick purely by having two members instead of one — even though
    // neither of those members need be more biologically related than a
    // lone biological parent living apart from the family. So a
    // biological/adoptive parent's pod always outranks a step parent's;
    // within the same tier, more of the child's parents in one pod (a
    // couple) still breaks the tie over a solo parent — but the overlap
    // count only credits members who are themselves biological/adoptive,
    // so a step co-parent can never inflate that tiebreak either.
    const bioParIds = parEntries.filter((p) => isBioAdopt(p.qualifier)).map((p) => p.id);
    const allParIds = parEntries.map((p) => p.id);
    let best2 = null, bestTier = -1, bestScore = -1;
    for (const pe of parEntries) {
      const pod = pods.get(podOfPerson.get(pe.id));
      if (!pod) continue;
      const tier = isBioAdopt(pe.qualifier) ? 1 : 0;
      const pool = tier ? bioParIds : allParIds;
      const score = pod.members.filter((m) => pool.includes(m)).length;
      if (tier > bestTier || (tier === bestTier && score > bestScore)) {
        bestTier = tier; bestScore = score; best2 = pod;
      }
    }
    if (best2) childPodOf.set(id, best2.id);
  }
  for (const pod of pods.values()) {
    const cp = childPodOf.get(pod.anchor);
    if (cp && pods.get(cp) && cp !== pod.id) pods.get(cp).childPods.push(pod);
  }

  // Stable child order: by birth year then name, so siblings read oldest→left.
  const birthYear = (id) => {
    const p = graph.byId.get(id);
    const m = String(p?.birth_date || '').match(/\d{4}/);
    return m ? parseInt(m[0], 10) : 9999;
  };
  for (const pod of pods.values()) {
    pod.childPods.sort((a, b) => birthYear(a.anchor) - birthYear(b.anchor)
      || (graph.byId.get(a.anchor)?.display_name || '').localeCompare(graph.byId.get(b.anchor)?.display_name || ''));
  }

  // ── 5. Roots = pods that are nobody's child. ──────────────────────────────
  const childPodIds = new Set();
  for (const pod of pods.values()) for (const c of pod.childPods) childPodIds.add(c.id);
  const rootPods = [...pods.values()].filter((p) => !childPodIds.has(p.id));

  return { pods, rootPods };
}

/*
 * computeChartLayout(graph, focalId) → Map<personId, {x, y}>
 * The set of positioned ids IS the chart's visible set (pos.keys()).
 * Canvas chart mode (BubbleTree.jsx) — one circular bubble per person,
 * couples drawn side by side within a pod.
 */
export function computeChartLayout(graph, focalId) {
  const pos = new Map();
  if (!focalId || !graph?.byId?.has(focalId)) return pos;
  const { rootPods } = buildPodTree(graph, focalId);

  // Widest root tree first, so multiple converging ancestor lines lay out deterministically.
  rootPods.sort((a, b) => subWidth(b) - subWidth(a));

  // ── 6. Tidy layout. ───────────────────────────────────────────────────────
  function podHalf(pod) {
    return pod.members.length === 2 ? (COUPLE_GAP / 2 + CARD / 2) : CARD / 2;
  }
  function podWidth(pod) { return podHalf(pod) * 2; }
  function subWidth(pod) {
    if (pod._sw != null) return pod._sw;
    const kids = pod.childPods;
    if (!kids.length) { pod._sw = podWidth(pod); return pod._sw; }
    let w = 0;
    for (let i = 0; i < kids.length; i++) { w += subWidth(kids[i]); if (i) w += SIB_GAP; }
    pod._sw = Math.max(podWidth(pod), w);
    return pod._sw;
  }
  function place(pod, left, depth) {
    const sw = subWidth(pod);
    const kids = pod.childPods;
    let center;
    if (!kids.length) {
      center = left + sw / 2;
    } else {
      let childrenW = 0;
      for (let i = 0; i < kids.length; i++) { childrenW += subWidth(kids[i]); if (i) childrenW += SIB_GAP; }
      let cx = left + (sw - childrenW) / 2;
      const centers = [];
      for (const k of kids) { centers.push(place(k, cx, depth + 1)); cx += subWidth(k) + SIB_GAP; }
      center = (centers[0] + centers[centers.length - 1]) / 2;
    }
    const y = depth * ROW_GAP;
    if (pod.members.length === 2) {
      pos.set(pod.members[0], { x: center - COUPLE_GAP / 2, y });
      pos.set(pod.members[1], { x: center + COUPLE_GAP / 2, y });
    } else {
      pos.set(pod.members[0], { x: center, y });
    }
    pod._cx = center;
    return center;
  }

  let cursor = 0;
  for (const rp of rootPods) { place(rp, cursor, 0); cursor += subWidth(rp) + FAM_GAP; }

  // ── 7. Centre the whole chart horizontally and lift it so the focal person's
  //       generation sits comfortably (rows start near the top). ─────────────
  if (pos.size) {
    let minX = Infinity, maxX = -Infinity;
    for (const p of pos.values()) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; }
    const shift = -((minX + maxX) / 2);
    const yLift = -ROW_GAP * 0.6;
    for (const p of pos.values()) { p.x += shift; p.y += yLift; }
  }

  return pos;
}

// ── DOM chart view (ChartTree.jsx) ──────────────────────────────────────────
// A couple shares ONE rectangular card (stacked rows) rather than two side-by-
// side bubbles, so pod width is constant regardless of solo/couple — only
// height differs. That plus per-branch collapse (an ancestor/descendant arm
// can be folded so the chart stays legible as a tree grows) is genuinely
// different geometry from the canvas chart above, hence its own step 6.
export const CHART_POD_W = 236;
export const CHART_POD_SOLO_H = 60;
export const CHART_POD_COUPLE_H = 100;
const TOGGLE_ROW_H = 26; // extra card height reserved when a pod has children (see podHeight, below)
const CHART_SIB_GAP = 32;
const CHART_FAM_GAP = 90;
const CHART_GEN_GAP = 150; // edge-to-edge between generation rows

/*
 * computeChartPods(graph, focalId, { collapsed, orientation }) →
 *   { pos: Map<podId, {x, y, w, h}>, pods: Map<podId, pod>, rootPodIds: [podId],
 *     connectors: [{id, parentPodId, childPodId}] }
 *
 * `collapsed` is a Set of podIds whose children should be hidden from the
 * layout (and whose subtree therefore takes up no width) — the caller still
 * gets each pod's real childPods so it can draw an "N more" expand affordance.
 * `orientation` is 'vertical' (default — oldest ancestor at top, descendants
 * below) or 'horizontal' (oldest ancestor at left, descendants to the right).
 */
export function computeChartPods(graph, focalId, { collapsed, orientation = 'vertical' } = {}) {
  const empty = { pos: new Map(), pods: new Map(), rootPodIds: [], connectors: [] };
  if (!focalId || !graph?.byId?.has(focalId)) return empty;
  const { pods, rootPods } = buildPodTree(graph, focalId);
  const collapsedSet = collapsed instanceof Set ? collapsed : new Set();
  const isCollapsed = (pod) => collapsedSet.has(pod.id);
  const kidsOf = (pod) => (isCollapsed(pod) ? [] : pod.childPods);
  // A pod with children always renders its "▾ N children" toggle (it doubles
  // as the collapse control when expanded, not just the expand control when
  // collapsed) — that's a real extra row ChartTree.jsx adds under the
  // member row(s). Reserve room for it here, or the card's own CSS
  // `overflow: hidden` silently clips the toggle clean off the bottom of the
  // card, which is what "I can't see how to expand it" turned out to be.
  const podHeight = (pod) => {
    const base = pod.members.length === 2 ? CHART_POD_COUPLE_H : CHART_POD_SOLO_H;
    return pod.childPods.length > 0 ? base + TOGGLE_ROW_H : base;
  };

  const horizontal = orientation === 'horizontal';
  // "Cross" is the axis siblings spread along; "main" is the axis generations
  // step along. Vertical mode: cross=x (constant card width), main=y
  // (generation rows). Horizontal swaps that — cross=y (card height, since
  // siblings now stack top-to-bottom), main=x (generation columns, spaced by
  // the card's real WIDTH since cards keep their normal landscape shape
  // rather than being rotated).
  const crossSize = (pod) => (horizontal ? podHeight(pod) : CHART_POD_W);
  const CROSS_GAP = horizontal ? 24 : CHART_SIB_GAP;
  const MAIN_STEP = horizontal ? CHART_POD_W + 96 : CHART_GEN_GAP;

  function subCross(pod) {
    if (pod._scw != null) return pod._scw;
    const kids = kidsOf(pod);
    let w;
    if (!kids.length) {
      w = crossSize(pod);
    } else {
      w = 0;
      for (let i = 0; i < kids.length; i++) { w += subCross(kids[i]); if (i) w += CROSS_GAP; }
      w = Math.max(crossSize(pod), w);
    }
    pod._scw = w;
    return w;
  }

  const cross = new Map(); // podId -> { center, depth }
  function place(pod, crossLeft, depth) {
    const sw = subCross(pod);
    const kids = kidsOf(pod);
    let center;
    if (!kids.length) {
      center = crossLeft + sw / 2;
    } else {
      let childrenW = 0;
      for (let i = 0; i < kids.length; i++) { childrenW += subCross(kids[i]); if (i) childrenW += CROSS_GAP; }
      let cx = crossLeft + (sw - childrenW) / 2;
      const centers = [];
      for (const k of kids) { centers.push(place(k, cx, depth + 1)); cx += subCross(k) + CROSS_GAP; }
      center = (centers[0] + centers[centers.length - 1]) / 2;
    }
    cross.set(pod.id, { center, depth });
    return center;
  }

  rootPods.sort((a, b) => subCross(b) - subCross(a));
  let cursor = 0;
  for (const rp of rootPods) { place(rp, cursor, 0); cursor += subCross(rp) + (horizontal ? 48 : CHART_FAM_GAP); }

  // Map cross/depth → screen x/y. Card w/h are always the pod's real
  // landscape footprint, regardless of which screen axis is "main".
  const pos = new Map();
  for (const [id, { center, depth }] of cross) {
    const pod = pods.get(id);
    const w = CHART_POD_W, h = podHeight(pod);
    const mainPos = depth * MAIN_STEP;
    pos.set(id, horizontal ? { x: mainPos, y: center, w, h } : { x: center, y: mainPos, w, h });
  }

  // Centre the whole chart along the cross axis.
  if (pos.size) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pos.values()) {
      const [a, b] = horizontal ? [p.y - p.h / 2, p.y + p.h / 2] : [p.x - p.w / 2, p.x + p.w / 2];
      lo = Math.min(lo, a); hi = Math.max(hi, b);
    }
    const shift = -((lo + hi) / 2);
    for (const p of pos.values()) { if (horizontal) p.y += shift; else p.x += shift; }
  }

  // Ghost "Add Father / Add Mother" cards one generation-step further from
  // the root pod, on the "past" side (up in vertical mode, left in
  // horizontal). Root pods are, by construction (see buildPodTree's
  // ancestorsRoots filter), genuinely parentless in the underlying graph —
  // this never fires for someone whose parents simply live outside the
  // chosen lineage. Purely a layout affordance; the click still opens the
  // same AddRelativeSheet used everywhere else in the app.
  const placeholderLinks = [];
  for (const rp of rootPods) {
    const rpPos = pos.get(rp.id);
    if (!rpPos) continue;
    const realParents = graph.parents(rp.anchor);
    if (realParents.length >= 2) continue;
    const haveGenders = new Set(realParents.map((p) => graph.byId.get(p.id)?.gender).filter(Boolean));
    const slots = [];
    if (realParents.length === 0) {
      slots.push('father', 'mother');
    } else if (!haveGenders.has('male')) {
      slots.push('father');
    } else if (!haveGenders.has('female')) {
      slots.push('mother');
    }
    if (!slots.length) continue;
    const spread = slots.length === 2 ? (horizontal ? CHART_POD_COUPLE_H * 0.7 : CHART_POD_W * 0.62) : 0;
    slots.forEach((slot, i) => {
      const id = `ph_${slot}_${rp.anchor}`;
      const off = slots.length === 2 ? (i === 0 ? -spread : spread) : 0;
      const entry = horizontal
        ? { x: rpPos.x - MAIN_STEP, y: rpPos.y + off, w: CHART_POD_W, h: CHART_POD_SOLO_H }
        : { x: rpPos.x + off, y: rpPos.y - MAIN_STEP, w: CHART_POD_W, h: CHART_POD_SOLO_H };
      pos.set(id, entry);
      pods.set(id, { id, placeholder: true, slot, forPersonId: rp.anchor, members: [], childPods: [] });
      placeholderLinks.push({ id, forPodId: rp.id });
    });
  }

  const connectors = [];
  for (const pod of pods.values()) {
    if (pod.placeholder || isCollapsed(pod) || !pos.has(pod.id)) continue;
    for (const child of pod.childPods) {
      if (!pos.has(child.id)) continue;
      connectors.push({ id: `${pod.id}->${child.id}`, parentPodId: pod.id, childPodId: child.id });
    }
  }
  for (const { id, forPodId } of placeholderLinks) {
    connectors.push({ id: `${id}->${forPodId}`, parentPodId: id, childPodId: forPodId });
  }

  return { pos, pods, rootPodIds: rootPods.filter((p) => pos.has(p.id)).map((p) => p.id), connectors };
}
