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
      ensure(partnersOf, r.from_person).push({ id: r.to_person, status: r.partner_status });
      ensure(partnersOf, r.to_person).push({ id: r.from_person, status: r.partner_status });
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

  // Niece / Nephew: a child of one of focus's siblings
  for (const s of graph.siblings(focusId)) {
    if (graph.children(s.id).some((x) => x.id === otherId)) {
      if (s.kind === 'step') return `Step-${g('Nephew', 'Niece', 'Niece/Nephew')}`;
      if (s.kind === 'half') return `Half-${g('Nephew', 'Niece', 'Niece/Nephew')}`;
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

  return 'Relative';
}
