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
      ensure(childrenOf, r.from_person).push({ id: r.to_person, qualifier: r.qualifier, relId: r.id });
      ensure(parentsOf, r.to_person).push({ id: r.from_person, qualifier: r.qualifier, relId: r.id });
    } else if (r.type === 'partner') {
      ensure(partnersOf, r.from_person).push({ id: r.to_person, status: r.partner_status, relId: r.id });
      ensure(partnersOf, r.to_person).push({ id: r.from_person, status: r.partner_status, relId: r.id });
    }
  }

  // Derive siblings: share at least one parent. Tag full vs half/step where we can.
  const siblingsOf = new Map();
  for (const person of people) {
    const myParents = (parentsOf.get(person.id) || []).map((x) => x.id);
    if (!myParents.length) continue;
    const seen = new Set();
    for (const parentId of myParents) {
      for (const child of childrenOf.get(parentId) || []) {
        if (child.id === person.id || seen.has(child.id)) continue;
        seen.add(child.id);
        const theirParents = (parentsOf.get(child.id) || []).map((x) => x.id);
        const shared = myParents.filter((pid) => theirParents.includes(pid)).length;
        ensure(siblingsOf, person.id).push({
          id: child.id,
          kind: shared >= 2 ? 'full' : 'half',
        });
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
  const focus = graph.byId.get(focusId);
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
      if (x.status === 'former') return g('Former partner', 'Former partner', 'Former partner');
      if (x.status === 'widowed') return g('Late husband', 'Late wife', 'Late partner');
      return g('Husband', 'Wife', 'Partner');
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
      const half = x.kind === 'half' ? 'Half-' : '';
      return `${half}${g('Brother', 'Sister', 'Sibling')}`;
    }
  }
  return 'Relative';
}
