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

// NOTE: this module now serves ONLY BubbleTree's canvas chart placement
// (computeChartLayout). The DOM chart view was rebuilt as a lazy pedigree —
// see pedigreeLayout.js — which replaced the computeChartPods half that used
// to live here.
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

  // The focal person's BLOOD relatives: themselves, every bio/adoptive
  // ancestor, and every bio/adoptive descendant of any of those ancestors
  // (siblings, cousins, nieces — anyone sharing a common ancestor). Married-in
  // partners are deliberately NOT in this set: a couple pod can only hang
  // under ONE member's parents, and it must be the member on the viewer's own
  // side of the family — otherwise someone looking at their own parents' card
  // finds their married-away child missing entirely, hung under the in-laws
  // instead (the pod tree is rebuilt per focal person, so from the in-laws'
  // own seat it flips the other way, which is exactly right).
  const blood = new Set([focalId]);
  {
    const up = [focalId];
    while (up.length) {
      const id = up.pop();
      for (const p of vParents(id)) {
        if (isBioAdopt(p.qualifier) && !blood.has(p.id)) { blood.add(p.id); up.push(p.id); }
      }
    }
    const down = [...blood];
    while (down.length) {
      const id = down.pop();
      for (const c of vChildren(id)) {
        if (isBioAdopt(c.qualifier) && !blood.has(c.id)) { blood.add(c.id); down.push(c.id); }
      }
    }
  }

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

  // Anchor preference (shared by both pairing passes). A pod hangs under its
  // ANCHOR's parents only, so anchor choice decides which side of a marriage
  // the chart traces through: first the member blood-related to the focal
  // person (see `blood` above — this is what puts a married-away child back
  // under their own parents when viewing from that side of the family), then
  // the member with bloodline parents in the tree, then who has more
  // children, then id order.
  const makeCouplePod = (a, b) => {
    let anchor = a, spouse = b;
    const aB = blood.has(a), bB = blood.has(b);
    if (bB && !aB) { anchor = b; spouse = a; }
    else if (aB === bB) {
      const aP = hasParents(a), bP = hasParents(b);
      if (bP && !aP) { anchor = b; spouse = a; }
      else if (aP === bP) {
        const ca = vChildren(a).length, cb = vChildren(b).length;
        if (cb > ca || (cb === ca && b < a)) { anchor = b; spouse = a; }
      }
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
    // When both bio parents landed in DIFFERENT pods (each re-partnered, or
    // one was claimed by a stronger co-parent pairing), the overlap score
    // ties 1–1 and the pick used to fall to raw iteration order — so which
    // parent a child hung under was arbitrary, and from that parent's own
    // side of the family the child simply looked missing. Blood-side
    // preference (same focal-relative set the anchor choice uses) breaks
    // that tie toward the parent on the viewer's side; overlap still
    // decides among same-side candidates (a couple pod beats a solo one).
    let best2 = null, bestTier = -1, bestBlood = -1, bestScore = -1;
    for (const pe of parEntries) {
      const pod = pods.get(podOfPerson.get(pe.id));
      if (!pod) continue;
      const tier = isBioAdopt(pe.qualifier) ? 1 : 0;
      const bloodPref = blood.has(pe.id) ? 1 : 0;
      const pool = tier ? bioParIds : allParIds;
      const score = pod.members.filter((m) => pool.includes(m)).length;
      if (
        tier > bestTier
        || (tier === bestTier && bloodPref > bestBlood)
        || (tier === bestTier && bloodPref === bestBlood && score > bestScore)
      ) {
        bestTier = tier; bestBlood = bloodPref; bestScore = score; best2 = pod;
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

