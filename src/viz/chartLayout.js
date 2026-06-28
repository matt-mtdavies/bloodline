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
 * Only the primary partner is shown per pod (the bloodline + who they married);
 * additional/former married-in partners are omitted to keep the tree unambiguous
 * — they remain fully present everywhere else in the app and in the data.
 *
 * computeChartLayout(graph, focalId) → Map<personId, {x, y}>
 * The set of positioned ids IS the chart's visible set (pos.keys()).
 */

const CARD = 92;          // card diameter (2 × BASE_RADIUS)
const COUPLE_GAP = 108;   // centre-to-centre between two spouses in a pod
const SIB_GAP = 44;       // edge-to-edge between sibling subtrees
const FAM_GAP = 110;      // edge-to-edge between separate root trees
const ROW_GAP = 240;      // vertical distance between generation rows

export function computeChartLayout(graph, focalId) {
  const pos = new Map();
  if (!focalId || !graph?.byId?.has(focalId)) return pos;

  const parentsOf = (id) => graph.parents(id);
  const childrenOf = (id) => graph.children(id);
  const partnersOf = (id) => graph.partners(id);
  const primaryPartnerId = (id) => {
    const ps = partnersOf(id);
    if (!ps.length) return null;
    return (ps.find((p) => p.status !== 'former') || ps[0]).id;
  };

  // ── 1. Choose a single root: the most senior ancestor whose descendant tree
  //       is the largest and contains the focal person (or their partner). This
  //       gives one complete, unambiguous tree instead of a forest. ──────────
  const ancestorsRoots = (startId) => {
    const up = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      for (const p of parentsOf(id)) if (!up.has(p.id)) { up.add(p.id); stack.push(p.id); }
    }
    return [...up].filter((id) => parentsOf(id).length === 0);
  };
  const descendantsOf = (rootId) => {
    const set = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      for (const c of childrenOf(id)) if (!set.has(c.id)) { set.add(c.id); stack.push(c.id); }
    }
    return set;
  };

  const focalPartner = primaryPartnerId(focalId);
  const candidateRoots = new Set([
    ...ancestorsRoots(focalId),
    ...(focalPartner ? ancestorsRoots(focalPartner) : []),
  ]);
  if (!candidateRoots.size) candidateRoots.add(focalId);

  let root = focalId, rootSet = descendantsOf(focalId), best = -1;
  for (const r of candidateRoots) {
    const set = descendantsOf(r);
    if (!(set.has(focalId) || (focalPartner && set.has(focalPartner)))) continue;
    if (set.size > best) { best = set.size; root = r; rootSet = set; }
  }

  // ── 2. Visible set: the chosen lineage + each member's primary partner. ────
  const visible = new Set(rootSet);
  for (const id of rootSet) {
    const pp = primaryPartnerId(id);
    if (pp) visible.add(pp);
  }
  const inV = (id) => visible.has(id);
  const vParents = (id) => parentsOf(id).filter((p) => inV(p.id));
  const vChildren = (id) => childrenOf(id).filter((c) => inV(c.id));

  // ── 3. Build pods (anchor = bloodline member; spouse drawn beside). ────────
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

  // Anchor preference: a pod's anchor should be the member with bloodline
  // parents when only one member has them (so up-links and children resolve to
  // the right side); ties broken by who has more children, then id order.
  for (const id of rootSet) {
    if (assigned.has(id)) continue;
    const partner = primaryPartnerId(id);
    if (partner && inV(partner) && !assigned.has(partner)) {
      let anchor = id, spouse = partner;
      const idP = hasParents(id), ptP = hasParents(partner);
      if (ptP && !idP) { anchor = partner; spouse = id; }
      else if (idP === ptP) {
        const ci = vChildren(id).length, cp = vChildren(partner).length;
        if (cp > ci || (cp === ci && partner < id)) { anchor = partner; spouse = id; }
      }
      makePod(anchor, spouse);
    } else {
      makePod(id, null);
    }
  }
  // Any visible person still unassigned (e.g. a primary partner who married in)
  // attaches to their partner's pod if there's room, else stands alone.
  for (const id of visible) {
    if (assigned.has(id)) continue;
    const partner = primaryPartnerId(id);
    const ppod = partner && pods.get(podOfPerson.get(partner));
    if (ppod && ppod.members.length === 1) {
      ppod.members.push(id); ppod.spouse = id;
      podOfPerson.set(id, ppod.id); assigned.add(id);
    } else {
      makePod(id, null);
    }
  }

  // ── 4. Parent → child pod links (each child attaches to one parent pod). ──
  const childPodOf = new Map(); // childPersonId → parent podId
  for (const id of rootSet) {
    const par = vParents(id).map((p) => p.id);
    if (!par.length) continue;
    // Prefer the pod that contains the most of this child's parents (a couple).
    let best2 = null, bestScore = -1;
    for (const pid of par) {
      const pod = pods.get(podOfPerson.get(pid));
      if (!pod) continue;
      const score = pod.members.filter((m) => par.includes(m)).length;
      if (score > bestScore) { bestScore = score; best2 = pod; }
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
  // Keep only the chosen lineage's root tree(s); prefer the one containing root.
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
