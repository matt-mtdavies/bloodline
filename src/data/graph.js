/*
 * Turns the flat person + relationship records into a graph the visualization
 * and the accessible view can both query: adjacency, derived siblings, partners,
 * parents, children, and BFS distance from whoever the camera is focused on.
 *
 * Siblings are DERIVED (people sharing at least one parent), never stored.
 */

export function buildGraph(people, relationships) {
  const byId = new Map(people.map((p) => [p.id, p]));

  const parentsOf = new Map(); // child -> [{id, qualifier}]
  const childrenOf = new Map(); // parent -> [{id, qualifier}]
  const partnersOf = new Map(); // person -> [{id, status}]

  const ensure = (m, k) => {
    if (!m.has(k)) m.set(k, []);
    return m.get(k);
  };

  for (const r of relationships) {
    if (r.type === 'parent') {
      ensure(childrenOf, r.from_person).push({ id: r.to_person, qualifier: r.qualifier });
      ensure(parentsOf, r.to_person).push({ id: r.from_person, qualifier: r.qualifier });
    } else if (r.type === 'partner') {
      // marriage_date/place are optional, additive edge metadata (see
      // store.js updatePartnerMeta) — carried through so the pedigree
      // chart's marriage strip can render them without a store lookup.
      ensure(partnersOf, r.from_person).push({ id: r.to_person, status: r.partner_status, is_married: r.is_married ?? false, marriage_date: r.marriage_date ?? null, marriage_place: r.marriage_place ?? null });
      ensure(partnersOf, r.to_person).push({ id: r.from_person, status: r.partner_status, is_married: r.is_married ?? false, marriage_date: r.marriage_date ?? null, marriage_place: r.marriage_place ?? null });
    }
  }

  // Derive siblings: share at least one parent. Three-way kind:
  //   full  — share 2+ biological/adoptive parents
  //   half  — share exactly 1 biological/adoptive parent
  //   step  — connected only through a step-parent (no shared bio/adoptive parent)
  const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';
  const siblingsOf = new Map();
  for (const person of people) {
    const myParents = parentsOf.get(person.id) || []; // [{id, qualifier}]
    if (!myParents.length) continue;
    const myBioIds = new Set(myParents.filter((p) => isBioAdopt(p.qualifier)).map((p) => p.id));
    const seen = new Set();
    for (const { id: parentId } of myParents) {
      for (const child of childrenOf.get(parentId) || []) {
        if (child.id === person.id || seen.has(child.id)) continue;
        seen.add(child.id);
        const theirParents = parentsOf.get(child.id) || [];
        const theirBioIds = theirParents.filter((p) => isBioAdopt(p.qualifier)).map((p) => p.id);
        const sharedBio = theirBioIds.filter((pid) => myBioIds.has(pid)).length;
        const kind = sharedBio >= 2 ? 'full' : sharedBio === 1 ? 'half' : 'step';
        ensure(siblingsOf, person.id).push({ id: child.id, kind });
      }
    }
  }

  return {
    byId,
    people,
    relationships,
    parentsOf,
    childrenOf,
    partnersOf,
    siblingsOf,
    parents: (id) => parentsOf.get(id) || [],
    children: (id) => childrenOf.get(id) || [],
    partners: (id) => partnersOf.get(id) || [],
    siblings: (id) => siblingsOf.get(id) || [],
  };
}

// Longest-path generation index from the eldest ancestors (no parents = 0).
// Shared by the canvas layout (BubbleTree's vertical bands) and the insights
// strata — both need in-law partners levelled onto their spouse's row and
// parents guaranteed strictly above their children, so the logic lives here
// rather than in either consumer.
export function computeGenerations(graph) {
  const gen = new Map();
  const visit = (id, guard) => {
    if (gen.has(id)) return gen.get(id);
    if (guard.has(id)) return 0;
    guard.add(id);
    const parents = graph.parents(id);
    let g = 0;
    for (const p of parents) g = Math.max(g, visit(p.id, guard) + 1);
    guard.delete(id);
    gen.set(id, g);
    return g;
  };
  for (const p of graph.people) visit(p.id, new Set());

  // Level active partners onto the same generation band using MAX — the deeper
  // partner's row wins, pulling the shallower one down to meet them.
  //
  // Former/ex partners are deliberately EXCLUDED: an ex from a different family
  // branch may have deeper ancestry, and dragging the current family member
  // down to match would cascade incorrectly (e.g. Jason getting pulled to
  // Kate's row instead of staying with Matthew).
  //
  // Multi-pass until stable so any chains converge (A=B, B=C → A=B=C).
  let changed = true;
  while (changed) {
    changed = false;
    const seen = new Set();
    for (const p of graph.people) {
      for (const partner of graph.partners(p.id)) {
        if (partner.status === 'former') continue;
        const key = [p.id, partner.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const a = gen.get(p.id) ?? 0;
        const b = gen.get(partner.id) ?? 0;
        if (a === b) continue;
        const lvl = Math.max(a, b);
        if (a !== lvl) { gen.set(p.id, lvl);           changed = true; }
        if (b !== lvl) { gen.set(partner.id, lvl);     changed = true; }
      }
    }
  }

  // The levelling above can pull a parent DOWN past their own child's row —
  // a child's generation was fixed in the first pass, before their parent
  // got dragged deeper to match a partner's separate, deeper ancestry (e.g.
  // Ray gets levelled to Flo's row, which happens to be at or past a row
  // Ray's own child from an earlier relationship already occupies). Cascade
  // children forward until every parent sits strictly above their children,
  // never the reverse — repeated to convergence so it propagates down
  // multiple generations if needed.
  // Bounded defensively: a valid family tree converges in well under
  // people.length passes, but corrupted/cyclic relationship data shouldn't
  // be able to hang the tab.
  let cascading = true;
  let guard = graph.people.length + 1;
  while (cascading && guard-- > 0) {
    cascading = false;
    for (const child of graph.people) {
      const childGen = gen.get(child.id) ?? 0;
      for (const parent of graph.parents(child.id)) {
        const parentGen = gen.get(parent.id) ?? 0;
        if (parentGen >= childGen) {
          gen.set(child.id, parentGen + 1);
          cascading = true;
        }
      }
    }
  }

  return gen;
}

// BFS hop-distance from a focus node across all relationship edges.
// Distance drives bubble size, blur, and opacity in the ego-centric camera.
export function distancesFrom(graph, focusId) {
  const dist = new Map([[focusId, 0]]);
  const queue = [focusId];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(cur);
    const neighbours = [
      ...graph.parents(cur).map((x) => x.id),
      ...graph.children(cur).map((x) => x.id),
      ...graph.partners(cur).map((x) => x.id),
      ...graph.siblings(cur).map((x) => x.id),
    ];
    for (const n of neighbours) {
      if (!dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

// Every ancestor, descendant, and collateral relative (sibling, aunt/uncle,
// cousin, …) connected to focusId by an unbroken chain of biological/adoptive
// parent-child links — the actual "blood or adoptive relative" the
// Bloodline-only toggle promises, computed once from the viewer rather than
// derived from however someone happened to end up in the expanded/visible
// set (a direct tap, a search result, or "Show all" — none of which imply
// anything about blood).
//
// Deliberately NOT a single symmetric BFS over parent+child edges: walking
// child edges up to a shared kid and then back UP through parent edges would
// also surface that kid's OTHER biological parent — an in-law who had
// children with a blood relative, but who isn't themselves an ancestor or a
// descendant of one. So this walks in two disciplined passes instead: first
// up to every ancestor (parents only, repeatedly), then down from each of
// those ancestors (children only, repeatedly) — which is exactly "everyone
// descended from someone I'm descended from," the standard definition of a
// blood/adoptive relative, and naturally covers full AND half siblings too
// (both are simply other children of a shared ancestor) with no separate
// sibling-edge lookup needed.
export function bloodRelativesOf(graph, focusId) {
  const ancestors = new Set([focusId]);
  let frontier = [focusId];
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      for (const p of graph.parents(cur)) {
        if (p.qualifier === 'step' || ancestors.has(p.id)) continue;
        ancestors.add(p.id);
        next.push(p.id);
      }
    }
    frontier = next;
  }

  const blood = new Set(ancestors);
  const queue = [...ancestors];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of graph.children(cur)) {
      if (c.qualifier === 'step' || blood.has(c.id)) continue;
      blood.add(c.id);
      queue.push(c.id);
    }
  }
  return blood;
}

// Buckets every person in the tree into one relationship category relative
// to viewerId, for the search overlay's filter chips — a person's SEARCH
// shortlist, not a replacement for the full relationship breakdown a
// profile shows. Same derivation PersonSheet/AccessibleTree already use for
// their extended-family groups (grandparents, aunts/uncles, cousins, ...),
// just computed once from the viewer's own seat instead of per-profile, and
// collapsed to fewer, coarser buckets — great-grandparents fold into
// "grandparents", grandchildren/nieces/nephews fold into one "descendants"
// bucket. Earlier/closer categories win on the rare overlap (e.g. a
// half-sibling who's also a step-cousin some other way stays "immediate").
export function relationshipCategories(graph, viewerId) {
  const cat = new Map();
  if (!viewerId || !graph.byId.has(viewerId)) return cat;

  const partners = graph.partners(viewerId);
  const parents = graph.parents(viewerId);
  const children = graph.children(viewerId);
  const siblings = graph.siblings(viewerId);
  for (const id of [viewerId, ...partners.map((x) => x.id), ...parents.map((x) => x.id),
    ...children.map((x) => x.id), ...siblings.map((x) => x.id)]) {
    cat.set(id, 'immediate');
  }

  // Only bio/adoptive lines propagate outward — step lines stop at the
  // immediate tier, same convention used for grandparents/aunts elsewhere.
  const upwardParents = parents.filter(
    (p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive',
  );
  const grandparentIds = upwardParents.flatMap((p) => graph.parents(p.id).map((gp) => gp.id));
  const greatGrandparentIds = grandparentIds.flatMap((id) => graph.parents(id).map((gp) => gp.id));
  for (const id of [...grandparentIds, ...greatGrandparentIds]) if (!cat.has(id)) cat.set(id, 'grandparents');

  const auntUncleIds = upwardParents.flatMap((p) => graph.siblings(p.id).map((s) => s.id));
  for (const id of auntUncleIds) if (!cat.has(id)) cat.set(id, 'aunts_uncles');

  const cousinIds = upwardParents.flatMap((p) =>
    graph.siblings(p.id).flatMap((s) => graph.children(s.id).map((c) => c.id)));
  for (const id of cousinIds) if (!cat.has(id)) cat.set(id, 'cousins');

  const grandchildIds = children.flatMap((c) => graph.children(c.id).map((gc) => gc.id));
  const greatGrandchildIds = grandchildIds.flatMap((id) => graph.children(id).map((gc) => gc.id));
  const nieceNephewIds = siblings.flatMap((s) => graph.children(s.id).map((c) => c.id));
  for (const id of [...grandchildIds, ...greatGrandchildIds, ...nieceNephewIds]) {
    if (!cat.has(id)) cat.set(id, 'descendants');
  }

  // Everyone left: blood relatives further out than the named buckets above
  // (2nd cousins, great-great-grandparents, ...) vs. everyone only
  // connected through a partnership — the graph only has parent/partner
  // edges, so "not blood" already means "in-law", no separate walk needed.
  const blood = bloodRelativesOf(graph, viewerId);
  for (const p of graph.people) {
    if (cat.has(p.id) || p.id === viewerId) continue;
    cat.set(p.id, blood.has(p.id) ? 'everyone_else' : 'in_laws');
  }
  return cat;
}

// Like pathBetween, but returns the ordered array [fromId, …, toId] (or null),
// so callers can render the chain start → end. pathBetween wraps this in a Set.
export function pathBetweenOrdered(graph, fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    const neighbours = [
      ...graph.parents(cur).map((x) => x.id),
      ...graph.children(cur).map((x) => x.id),
      ...graph.partners(cur).map((x) => x.id),
    ];
    for (const n of neighbours) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === toId) {
        const path = [];
        let c = toId;
        while (c !== null) { path.push(c); c = prev.get(c); }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

// BFS shortest path between two nodes across all relationship edges. Returns a
// Set of person IDs on the path (including both endpoints), or null if no path.
export function pathBetween(graph, fromId, toId) {
  if (fromId === toId) return new Set([fromId]);
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    const neighbours = [
      ...graph.parents(cur).map((x) => x.id),
      ...graph.children(cur).map((x) => x.id),
      ...graph.partners(cur).map((x) => x.id),
    ];
    for (const n of neighbours) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === toId) {
        const path = new Set();
        let c = toId;
        while (c !== null) { path.add(c); c = prev.get(c); }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

const MASC_TERMS = ['male', 'm', 'man'];
const FEM_TERMS = ['female', 'f', 'woman'];
function byGender(gender, m, f, n) {
  const gl = (gender || '').toLowerCase();
  return MASC_TERMS.includes(gl) ? m : FEM_TERMS.includes(gl) ? f : n;
}

// Walks upward from `id` via biological/adoptive parent links only — step
// lines stop at the immediate tier, same convention used elsewhere for
// grandparents/aunts (see the `upwardParents` filter in PersonSheet). Records
// each ancestor's distance and the very FIRST hop's parent entry, since the
// paternal/maternal side of a relationship is always determined by that
// first step, never recomputed at each level up.
function ancestorsWithDistance(graph, id, maxDepth = 8) {
  const map = new Map();
  let frontier = [{ id, distance: 0, firstHopParent: null }];
  // The starting person counts as their own distance-0 "ancestor" — without
  // this, a case where the common ancestor IS focus or IS other (a pure
  // ascending/descending chain, e.g. a 4x-great-grandparent with no named
  // pattern) could never be found: looking up the other side's map by that
  // id would come back empty even though the relationship is real.
  map.set(id, frontier[0]);
  const visited = new Set([id]);
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      const upwardParents = graph.parents(node.id).filter(
        (p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive',
      );
      for (const p of upwardParents) {
        if (visited.has(p.id)) continue;
        visited.add(p.id);
        const n = { id: p.id, distance: node.distance + 1, firstHopParent: node.firstHopParent || p };
        next.push(n);
        map.set(n.id, n);
      }
    }
    frontier = next;
  }
  return map;
}

// "N generations up" — Parent/Grandparent/Great-grandparent/Great-great-.../etc.
function ascendingTerm(n, gender) {
  if (n === 1) return byGender(gender, 'Father', 'Mother', 'Parent');
  if (n === 2) return byGender(gender, 'Grandfather', 'Grandmother', 'Grandparent');
  // Spelled out (great-great-grandfather), not "2x Great-" shorthand — only
  // the leading "Great-" is capitalised, matching normal usage.
  const greats = n - 2;
  const prefix = 'Great-' + 'great-'.repeat(greats - 1);
  return `${prefix}${byGender(gender, 'grandfather', 'grandmother', 'grandparent')}`;
}

// "N generations down" — Child/Grandchild/Great-grandchild/Great-great-.../etc.
function descendingTerm(n, gender) {
  if (n === 1) return byGender(gender, 'Son', 'Daughter', 'Child');
  if (n === 2) return byGender(gender, 'Grandson', 'Granddaughter', 'Grandchild');
  const greats = n - 2;
  const prefix = 'Great-' + 'great-'.repeat(greats - 1);
  return `${prefix}${byGender(gender, 'grandson', 'granddaughter', 'grandchild')}`;
}

// 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 21 -> "21st"... for "2nd Cousin" etc.
function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

// Human-readable relationship of `otherId` relative to `focusId`, for the
// accessible view and the person sheet. Best-effort, kept warm and plain.
export function relationLabel(graph, focusId, otherId) {
  if (focusId === otherId) return 'You';
  const masc = ['male', 'm', 'man'];
  const fem = ['female', 'f', 'woman'];
  const other = graph.byId.get(otherId);
  const g = (m, f, n) =>
    masc.includes((other?.gender || '').toLowerCase())
      ? m
      : fem.includes((other?.gender || '').toLowerCase())
        ? f
        : n;

  for (const x of graph.partners(focusId)) {
    if (x.id === otherId) {
      if (x.status === 'former') return 'Former partner';
      if (x.status === 'widowed') return 'Late partner';
      return 'Partner';
    }
  }
  for (const x of graph.parents(focusId)) {
    if (x.id === otherId) {
      const q = x.qualifier && x.qualifier !== 'biological' ? `${x.qualifier} ` : '';
      return g(`${q}Father`, `${q}Mother`, `${q}Parent`).replace(/^(\w)/, (c) => c.toUpperCase());
    }
  }
  for (const x of graph.children(focusId)) {
    if (x.id === otherId) {
      const q = x.qualifier && x.qualifier !== 'biological' ? `${x.qualifier} ` : '';
      return `${q}${g('Son', 'Daughter', 'Child')}`.replace(/^(\w)/, (c) => c.toUpperCase());
    }
  }
  for (const x of graph.siblings(focusId)) {
    if (x.id === otherId) {
      const prefix = x.kind === 'half' ? 'Half-' : x.kind === 'step' ? 'Step-' : '';
      return `${prefix}${g('Brother', 'Sister', 'Sibling')}`;
    }
  }

  // ── 2-hop relationships ──────────────────────────────────────────────────

  // Determine the relational side prefix from a parent entry {id, qualifier}.
  // Biological father → 'Paternal'; biological mother → 'Maternal';
  // step- or adoptive parent → 'Step' / 'Adoptive' (gender is irrelevant for
  // naming — a step-father's sister is a step-aunt, not a paternal aunt).
  const parentSide = (parentEntry) => {
    const q = parentEntry.qualifier || 'biological';
    if (q === 'step') return 'Step';
    if (q === 'adoptive') return 'Adoptive';
    const pg = (graph.byId.get(parentEntry.id)?.gender || '').toLowerCase();
    return masc.includes(pg) ? 'Paternal' : fem.includes(pg) ? 'Maternal' : null;
  };

  // Grandparent: one of focus's parents is a child of otherId
  for (const p of graph.parents(focusId)) {
    const gpEntry = graph.parents(p.id).find((x) => x.id === otherId);
    if (gpEntry) {
      const s = parentSide(p);
      // Step/adoptive on either link in the chain makes it a step/adoptive grandparent
      if (s === 'Step' || gpEntry.qualifier === 'step') return 'Step Grandparent';
      if (s === 'Adoptive' || gpEntry.qualifier === 'adoptive') return 'Adoptive Grandparent';
      return `${s ? s + ' ' : ''}${g('Grandfather', 'Grandmother', 'Grandparent')}`;
    }
  }

  // Grandchild: one of focus's children has otherId as their child
  for (const c of graph.children(focusId)) {
    const gcEntry = graph.children(c.id).find((x) => x.id === otherId);
    if (gcEntry) {
      const isStep = c.qualifier === 'step' || gcEntry.qualifier === 'step';
      const isAdopt = !isStep && (c.qualifier === 'adoptive' || gcEntry.qualifier === 'adoptive');
      if (isStep) return `Step-${g('Grandson', 'Granddaughter', 'Grandchild')}`;
      if (isAdopt) return `Adoptive ${g('Grandson', 'Granddaughter', 'Grandchild')}`;
      return g('Grandson', 'Granddaughter', 'Grandchild');
    }
  }

  // Great-grandparent: grandparent's parent
  for (const p of graph.parents(focusId)) {
    for (const gp of graph.parents(p.id)) {
      const ggpEntry = graph.parents(gp.id).find((x) => x.id === otherId);
      if (ggpEntry) {
        const isStep = p.qualifier === 'step' || gp.qualifier === 'step' || ggpEntry.qualifier === 'step';
        const isAdopt = !isStep && (p.qualifier === 'adoptive' || gp.qualifier === 'adoptive' || ggpEntry.qualifier === 'adoptive');
        if (isStep) return 'Step Great-grandparent';
        if (isAdopt) return 'Adoptive Great-grandparent';
        return g('Great-grandfather', 'Great-grandmother', 'Great-grandparent');
      }
    }
  }

  // Great-grandchild: grandchild's child
  for (const c of graph.children(focusId)) {
    for (const gc of graph.children(c.id)) {
      const ggcEntry = graph.children(gc.id).find((x) => x.id === otherId);
      if (ggcEntry) {
        const isStep = c.qualifier === 'step' || gc.qualifier === 'step' || ggcEntry.qualifier === 'step';
        const isAdopt = !isStep && (c.qualifier === 'adoptive' || gc.qualifier === 'adoptive' || ggcEntry.qualifier === 'adoptive');
        if (isStep) return `Step Great-${g('grandson', 'granddaughter', 'grandchild')}`;
        if (isAdopt) return `Adoptive Great-${g('grandson', 'granddaughter', 'grandchild')}`;
        return g('Great-grandson', 'Great-granddaughter', 'Great-grandchild');
      }
    }
  }

  // Aunt / Uncle: a sibling of focus's parent
  for (const p of graph.parents(focusId)) {
    const matchedSib = graph.siblings(p.id).find((x) => x.id === otherId);
    if (matchedSib) {
      // Step/half sibling of parent → step/half aunt/uncle, regardless of side.
      if (matchedSib.kind === 'step') return `Step ${g('Uncle', 'Aunt', 'Aunt/Uncle')}`;
      if (matchedSib.kind === 'half') return `Half-${g('Uncle', 'Aunt', 'Aunt/Uncle')}`;
      const s = parentSide(p);
      const prefix = s ? `${s} ` : '';
      return `${prefix}${g('Uncle', 'Aunt', 'Aunt/Uncle')}`;
    }
    // Partner of parent's sibling (uncle/aunt by marriage)
    for (const sib of graph.siblings(p.id)) {
      if (graph.partners(sib.id).some((x) => x.id === otherId)) {
        if (sib.kind === 'step') return `Step ${g('Uncle', 'Aunt', 'Aunt/Uncle')} (by marriage)`;
        if (sib.kind === 'half') return `Half-${g('Uncle', 'Aunt', 'Aunt/Uncle')} (by marriage)`;
        const sp = parentSide(p);
        const prefix = sp ? `${sp} ` : '';
        return `${prefix}${g('Uncle', 'Aunt', 'Aunt/Uncle')} (by marriage)`;
      }
    }
  }

  // Niece / Nephew: a child of one of focus's siblings. It's a *step* niece/
  // nephew if either link is step — the sibling is a step-sibling, OR they are
  // the sibling's step-child (e.g. a sibling married someone with kids).
  for (const s of graph.siblings(focusId)) {
    const childEntry = graph.children(s.id).find((x) => x.id === otherId);
    if (childEntry) {
      const isStep = s.kind === 'step' || childEntry.qualifier === 'step';
      if (isStep) return `Step-${g('Nephew', 'Niece', 'Niece/Nephew')}`;
      if (s.kind === 'half') return `Half-${g('Nephew', 'Niece', 'Niece/Nephew')}`;
      if (childEntry.qualifier === 'adoptive') return `Adoptive ${g('Nephew', 'Niece', 'Niece/Nephew')}`;
      return g('Nephew', 'Niece', 'Niece/Nephew');
    }
  }

  // Cousin: child of focus's aunt/uncle
  for (const p of graph.parents(focusId)) {
    for (const s of graph.siblings(p.id)) {
      if (graph.children(s.id).some((x) => x.id === otherId)) {
        const isStep = p.qualifier === 'step' || s.kind === 'step';
        if (isStep) return 'Step-Cousin';
        if (s.kind === 'half') return 'Half-Cousin';
        return 'Cousin';
      }
    }
  }

  // General fallback for anything more distant than the named patterns
  // above — reduces the relationship to "up N generations (from focus) to
  // a shared ancestor, down M generations (to other)" and describes it
  // as "[side] [ascending term]'s [descending term]" — e.g. what a
  // genealogist would call "1st cousin once removed" instead reads as
  // "Maternal Great-grandfather's Grandson". Only ever reached here, since
  // every closer/named relationship already returned above.
  const upFromFocus = ancestorsWithDistance(graph, focusId);
  const upFromOther = ancestorsWithDistance(graph, otherId);
  let nearest = null;
  for (const [ancId, focusNode] of upFromFocus) {
    const otherNode = upFromOther.get(ancId);
    if (!otherNode) continue;
    const total = focusNode.distance + otherNode.distance;
    if (!nearest || total < nearest.total) {
      nearest = { ancId, upDist: focusNode.distance, downDist: otherNode.distance, total, firstHopParent: focusNode.firstHopParent };
    }
  }
  if (nearest && nearest.total > 0) {
    const { ancId, upDist, downDist, firstHopParent } = nearest;
    const side = firstHopParent ? parentSide(firstHopParent) : null;
    const sidePrefix = side ? `${side} ` : '';
    if (downDist === 0) return `${sidePrefix}${ascendingTerm(upDist, other?.gender)}`;
    if (upDist === 0) return descendingTerm(downDist, other?.gender);

    // Cousin-shaped: both focus and other are at least two generations down
    // from the shared ancestor (neither is the ancestor's direct child) —
    // "cousin's daughter" reads far more naturally here than continuing to
    // describe the shared ancestor itself ("paternal grandfather's
    // great-granddaughter" for the exact same person). No side prefix on
    // this branch — "paternal cousin" isn't how anyone actually says it.
    if (upDist >= 2 && downDist >= 2) {
      const degree = Math.min(upDist, downDist) - 1; // 1 = cousin, 2 = 2nd cousin, ...
      const cousinWord = degree === 1 ? 'Cousin' : `${ordinal(degree)} Cousin`;
      const removed = downDist - upDist;
      if (removed === 0) return cousinWord;
      if (removed > 0) return `${cousinWord}'s ${descendingTerm(removed, other?.gender)}`;
      // Other is closer to the shared ancestor than focus is — exactly 1
      // hop up from focus, `firstHopParent`'s gender is known precisely;
      // further than that, there's no per-hop gender tracked, so it reads
      // as the neutral "Parent"/"Grandparent" rather than guessing wrong.
      const upGender = -removed === 1 ? graph.byId.get(firstHopParent?.id)?.gender : null;
      return `${ascendingTerm(-removed, upGender)}'s ${cousinWord}`;
    }

    const ancestorGender = graph.byId.get(ancId)?.gender;
    return `${sidePrefix}${ascendingTerm(upDist, ancestorGender)}'s ${descendingTerm(downDist, other?.gender)}`;
  }

  return 'Relative';
}

// Turn an ordered path (as returned by pathBetweenOrdered) into the
// possessive relationship chain shown by both the search flyover
// (FlightCaption) and Lineage mode (LineageBanner) — "Father's Brother's
// Daughter" rather than a relation-to-viewer for every hop, which degrades
// to a generic "Relative" for anyone reached via an in-law or sideways
// branch. Each crumb is the hop's relation to the person immediately
// before it in the chain, which is always resolvable since adjacent path
// nodes are always directly connected by exactly one real edge (parent/
// child/partner/sibling).
//
// Two collapses on top of that turn-by-turn base:
//  1. Siblings have no direct edge of their own (derived, never stored) —
//     the path still runs through their shared parent, but narrating that
//     stop as its own word reads as "Father's Father's Son" for what is
//     actually just "Father's Brother", so two hops that go up to a shared
//     parent and immediately back down to their other child collapse into
//     one sibling crumb.
//  2. "Sister's Son" / "Mother's Sister" are correctly-worded but not how
//     anyone would actually say it — those adjacent-crumb pairs read as one
//     relationship (Nephew/Niece, Aunt/Uncle) once said together, so they
//     merge into that single word wherever the two crumbs' own endpoints
//     genuinely form that pattern in the graph.
//
// Returns [{ label, fromIndex, toIndex }], indices into `order`.
export function buildRelationCrumbs(graph, order) {
  const rawCrumbs = [];
  for (let i = 1; i < order.length; ) {
    const mid = order[i];
    if (i + 1 < order.length) {
      const a = order[i - 1];
      const b = order[i + 1];
      const midIsSharedParent =
        graph.parents(a).some((p) => p.id === mid) && graph.parents(b).some((p) => p.id === mid);
      if (midIsSharedParent) {
        rawCrumbs.push({ label: relationLabel(graph, a, b), fromIndex: i - 1, toIndex: i + 1 });
        i += 2;
        continue;
      }
    }
    rawCrumbs.push({ label: relationLabel(graph, order[i - 1], mid), fromIndex: i - 1, toIndex: i });
    i += 1;
  }

  const crumbs = [];
  for (let i = 0; i < rawCrumbs.length; i++) {
    const cur = rawCrumbs[i];
    const nxt = rawCrumbs[i + 1];
    if (nxt) {
      const a = order[cur.fromIndex];
      const mid = order[cur.toIndex];
      const c = order[nxt.toIndex];
      const siblingThenChild =
        graph.siblings(a).some((s) => s.id === mid) && graph.children(mid).some((ch) => ch.id === c);
      const parentThenSibling =
        graph.parents(a).some((p) => p.id === mid) && graph.siblings(mid).some((s) => s.id === c);
      if (siblingThenChild || parentThenSibling) {
        crumbs.push({ label: relationLabel(graph, a, c), fromIndex: cur.fromIndex, toIndex: nxt.toIndex });
        i += 1;
        continue;
      }
    }
    crumbs.push(cur);
  }
  return crumbs;
}
