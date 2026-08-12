import { computeGenerations } from '../../data/graph.js';

export const MAX_FOCUS_DESKTOP = 30;
export const MAX_FOCUS_MOBILE = 8;
export const MAX_BRANCH_BATCH = 8;

function hash(value) {
  let h = 2166136261;
  for (const char of String(value || '')) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nameOf(person) {
  return person?.display_name || [person?.given_names, person?.family_name].filter(Boolean).join(' ') || 'Unknown relative';
}

function surnameOf(person) {
  if (person?.family_name) return person.family_name.trim();
  const bits = nameOf(person).trim().split(/\s+/);
  return bits.length > 1 ? bits.at(-1) : 'Family';
}

function born(person) {
  return person?.birth_date || '9999';
}

function sortedIds(graph, ids) {
  return [...new Set(ids)].filter((id) => graph.byId.has(id)).sort((a, b) => {
    const pa = graph.byId.get(a);
    const pb = graph.byId.get(b);
    return born(pa).localeCompare(born(pb)) || nameOf(pa).localeCompare(nameOf(pb)) || String(a).localeCompare(String(b));
  });
}

function directIds(graph, id) {
  return [
    ...graph.parents(id).map((x) => x.id),
    ...graph.partners(id).map((x) => x.id),
    ...graph.children(id).map((x) => x.id),
    ...graph.siblings(id).map((x) => x.id),
  ];
}

/**
 * Stable, selection-independent coordinates for the quiet context atlas.
 * Surname lanes make large branches read as constellations while generation
 * rows preserve a faint sense of time. Nothing here is simulated.
 */
export function createAtlasPositions(graph, viewport) {
  const width = viewport.width;
  const height = viewport.height;
  const marginX = Math.max(42, width * 0.055);
  const marginY = Math.max(90, height * 0.12);
  const generations = computeGenerations(graph);
  const maxGen = Math.max(1, ...generations.values());

  const surnameCounts = new Map();
  for (const person of graph.people) {
    const surname = surnameOf(person);
    surnameCounts.set(surname, (surnameCounts.get(surname) || 0) + 1);
  }
  const lanes = [...surnameCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([surname]) => surname);
  const laneIndex = new Map(lanes.map((surname, index) => [surname, index]));
  const laneCount = Math.max(1, lanes.length);
  const positions = new Map();

  for (const person of graph.people) {
    const lane = laneIndex.get(surnameOf(person)) || 0;
    const laneT = laneCount === 1 ? 0.5 : lane / (laneCount - 1);
    const generation = generations.get(person.id) || 0;
    const generationT = maxGen ? generation / maxGen : 0.5;
    const h = hash(person.id);
    const jitterX = (((h & 1023) / 1023) - 0.5) * Math.min(72, width / Math.max(8, laneCount));
    const jitterY = ((((h >>> 10) & 1023) / 1023) - 0.5) * 42;
    positions.set(person.id, {
      x: marginX + laneT * (width - marginX * 2) + jitterX,
      y: marginY + generationT * (height - marginY * 2) + jitterY,
      lane,
      generation,
      surname: surnameOf(person),
    });
  }
  return { positions, lanes, generations };
}

/**
 * A bounded, explainable neighbourhood. Direct family always wins the visual
 * budget, followed by one generation of contextual ancestors/descendants and
 * finally partners of children/siblings. The Perimeter remains a separate
 * product preference; this is only the number of people a viewport can stage.
 */
export function collectFocusIds(graph, activeId, maxPeople = MAX_FOCUS_DESKTOP, { mobile = false } = {}) {
  const chosen = [];
  const seen = new Set();
  const add = (ids) => {
    for (const id of sortedIds(graph, ids)) {
      if (seen.has(id) || chosen.length >= maxPeople) continue;
      seen.add(id);
      chosen.push(id);
    }
  };

  add([activeId]);
  const parents = sortedIds(graph, graph.parents(activeId).map((x) => x.id));
  const partnerEdges = graph.partners(activeId);
  const partners = [
    ...sortedIds(graph, partnerEdges.filter((x) => x.status !== 'former').map((x) => x.id)),
    ...sortedIds(graph, partnerEdges.filter((x) => x.status === 'former').map((x) => x.id)),
  ];
  const children = sortedIds(graph, graph.children(activeId).map((x) => x.id));
  const siblings = sortedIds(graph, graph.siblings(activeId).map((x) => x.id));

  // A phone is a portrait, not a compressed desktop canvas. Keep the stage
  // within explicit row capacities: two partners, two parents, and three
  // children. Siblings only enter when those core rows leave genuine visual
  // room. Continuation badges carry everyone else without asking the user to
  // repair an impossible 12-person composition by dragging portraits around.
  if (mobile) {
    add(partners.slice(0, 2));
    add(parents.slice(0, 2));
    add(children.slice(0, 3));
    const siblingSlots = chosen.length <= 5 ? 2 : chosen.length === 6 ? 1 : 0;
    add(siblings.slice(0, siblingSlots));
    return new Set(chosen);
  }

  add(partners);
  add(parents);
  add(children);
  add(siblings);

  // Context radiates through the active family unit, never recursively.
  add(parents.flatMap((id) => graph.parents(id).map((x) => x.id)));
  add(children.flatMap((id) => graph.children(id).map((x) => x.id)));
  add([...children, ...siblings].flatMap((id) => graph.partners(id).map((x) => x.id)));
  add(partners.flatMap((id) => [
    ...graph.parents(id).map((x) => x.id),
    ...graph.children(id).map((x) => x.id),
  ]));

  return new Set(chosen);
}

function spread(count, centre, gap, maxWidth) {
  if (!count) return [];
  const actualGap = count === 1 ? 0 : Math.min(gap, maxWidth / (count - 1));
  return Array.from({ length: count }, (_, index) => centre + (index - (count - 1) / 2) * actualGap);
}

/**
 * Siblings the product can explain from recorded relationships. `graph.siblings`
 * supplies full/half/explicit-step siblings. A parent's partner's other child
 * is also a step-sibling even when the import did not create a synthetic
 * step-parent edge. This is a read-only view inference; it never changes data.
 */
export function siblingsFor(graph, id) {
  const myParents = graph.parents(id);
  const found = new Map(graph.siblings(id).map((entry) => {
    const theirParents = graph.parents(entry.id);
    const shared = myParents.filter((mine) => theirParents.some((theirs) => theirs.id === mine.id));
    // GEDCOM PEDI describes the child's relationship to a FAM, not to each
    // parent independently. Mixed biological/step exports can therefore mark
    // both imported parent edges as step. Two identical recorded parents are
    // still an unambiguous full-sibling structure and must win that lossy
    // qualifier; one shared non-step parent is a half-sibling.
    let kind = entry.kind;
    if (shared.length >= 2) kind = 'full';
    else if (shared.length === 1) {
      const mine = shared[0];
      const theirs = theirParents.find((parent) => parent.id === mine.id);
      if (mine.qualifier !== 'step' && theirs?.qualifier !== 'step') kind = 'half';
    }
    return [entry.id, { ...entry, kind }];
  }));
  for (const parent of graph.parents(id)) {
    for (const partner of graph.partners(parent.id)) {
      for (const child of graph.children(partner.id)) {
        if (child.id === id || found.has(child.id)) continue;
        found.set(child.id, { id: child.id, kind: 'step' });
      }
    }
  }
  return [...found.values()];
}

function relatedByType(graph, id, type) {
  if (type === 'parent') return sortedIds(graph, graph.parents(id).map((entry) => entry.id));
  if (type === 'partner') {
    const entries = graph.partners(id);
    return [
      ...sortedIds(graph, entries.filter((entry) => entry.status !== 'former').map((entry) => entry.id)),
      ...sortedIds(graph, entries.filter((entry) => entry.status === 'former').map((entry) => entry.id)),
    ];
  }
  if (type === 'child') return sortedIds(graph, graph.children(id).map((entry) => entry.id));
  if (type === 'sibling') return sortedIds(graph, siblingsFor(graph, id).filter((entry) => entry.kind !== 'step').map((entry) => entry.id));
  if (type === 'step-sibling') return sortedIds(graph, siblingsFor(graph, id).filter((entry) => entry.kind === 'step').map((entry) => entry.id));
  return [];
}

const BRANCH_LABELS = {
  parent: ['Parent', 'Parents'],
  partner: ['Partner', 'Partners'],
  child: ['Child', 'Children'],
  sibling: ['Sibling', 'Siblings'],
  'step-sibling': ['Step-sibling', 'Step-siblings'],
};

export function branchGroups(graph, id, visibleIds) {
  return ['parent', 'partner', 'child', 'sibling', 'step-sibling'].map((type) => {
    const ids = relatedByType(graph, id, type).filter((candidate) => !visibleIds.has(candidate));
    const labels = BRANCH_LABELS[type];
    return { type, ids, label: ids.length === 1 ? labels[0] : labels[1] };
  }).filter((group) => group.ids.length);
}

function groupPoints(count, columns, centreX, centreY, gapX, gapY) {
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    x: centreX + (index % columns - (Math.min(columns, count) - 1) / 2) * gapX,
    y: centreY + (Math.floor(index / columns) - (rows - 1) / 2) * gapY,
  }));
}

/**
 * People are selectable, so every coordinate reserves room for the larger
 * selected portrait and its two-line nameplate—not merely the resting disc.
 * The score is intentionally deterministic: existing people never move and
 * the first equally-clear candidate wins.
 */
function placementScore(points, positions, mobile, preference) {
  const clearanceX = mobile ? 112 : 132;
  const clearanceY = mobile ? 116 : 136;
  let score = preference;
  for (const point of points) {
    for (const existing of positions.values()) {
      const overlapX = clearanceX - Math.abs(point.x - existing.x);
      const overlapY = clearanceY - Math.abs(point.y - existing.y);
      if (overlapX > 0 && overlapY > 0) score += 1_000_000 + overlapX * overlapY;
    }
  }
  return score;
}

function clearGroupPlacement(positions, anchor, count, type, mobile) {
  const siblingBranch = type === 'sibling' || type === 'step-sibling';
  const columns = siblingBranch ? Math.min(3, count) : Math.max(1, count);
  const rows = Math.ceil(count / columns);
  const gapX = mobile ? 112 : 140;
  const gapY = mobile ? 122 : 144;
  const halfWidth = ((Math.min(columns, count) - 1) * gapX) / 2;
  const halfHeight = ((rows - 1) * gapY) / 2;
  const horizontal = halfWidth + (mobile ? 126 : 154);
  const vertical = halfHeight + (mobile ? 148 : 176);
  const values = [...positions.values()];
  const minX = Math.min(...values.map((point) => point.x));
  const maxX = Math.max(...values.map((point) => point.x));
  const minY = Math.min(...values.map((point) => point.y));
  const maxY = Math.max(...values.map((point) => point.y));

  let centres;
  if (type === 'parent') {
    centres = [
      [anchor.x, anchor.y - vertical],
      [anchor.x - horizontal, anchor.y - vertical],
      [anchor.x + horizontal, anchor.y - vertical],
      [anchor.x, minY - vertical],
      [minX - horizontal, minY - vertical],
      [maxX + horizontal, minY - vertical],
    ];
  } else if (type === 'child') {
    centres = [
      [anchor.x, anchor.y + vertical],
      [anchor.x - horizontal, anchor.y + vertical],
      [anchor.x + horizontal, anchor.y + vertical],
      [anchor.x, maxY + vertical],
      [minX - horizontal, maxY + vertical],
      [maxX + horizontal, maxY + vertical],
    ];
  } else {
    centres = [
      [anchor.x - horizontal, anchor.y],
      [anchor.x + horizontal, anchor.y],
      [anchor.x - horizontal, anchor.y - vertical],
      [anchor.x + horizontal, anchor.y - vertical],
      [anchor.x - horizontal, anchor.y + vertical],
      [anchor.x + horizontal, anchor.y + vertical],
      [minX - horizontal, anchor.y],
      [maxX + horizontal, anchor.y],
      [minX - horizontal, minY - vertical],
      [maxX + horizontal, maxY + vertical],
    ];
  }

  return centres
    .map(([x, y], index) => {
      const points = groupPoints(count, columns, x, y, gapX, gapY);
      return { points, score: placementScore(points, positions, mobile, index * 100) };
    })
    .sort((a, b) => a.score - b.score)[0].points;
}

/**
 * Builds a persistent world from the calm opening portrait, then applies
 * branch expansions in order. Existing coordinates never change; only newly
 * revealed relatives receive positions. This is the spatial-memory contract
 * the fixed-centre prototype could not provide.
 */
export function createLivingScene(graph, rootId, viewport, expansions = []) {
  const opening = createAtlasModel(graph, rootId, viewport);
  const positions = new Map();
  for (const [id, point] of opening.focusPositions) {
    positions.set(id, { ...point, x: point.x - opening.centre.x, y: point.y - opening.centre.y, anchorId: rootId });
  }
  const visibleIds = new Set(positions.keys());
  let newestIds = [];

  for (const expansion of expansions) {
    const anchor = positions.get(expansion.anchorId);
    if (!anchor) continue;
    const candidates = relatedByType(graph, expansion.anchorId, expansion.type)
      .filter((id) => !visibleIds.has(id))
      .slice(0, MAX_BRANCH_BATCH);
    if (!candidates.length) continue;

    const mobile = viewport.width < 620;
    const siblingBranch = expansion.type === 'sibling' || expansion.type === 'step-sibling';
    const points = clearGroupPlacement(positions, anchor, candidates.length, expansion.type, mobile);
    candidates.forEach((id, index) => {
      positions.set(id, {
        x: points[index].x,
        y: points[index].y,
        role: siblingBranch ? 'sibling' : expansion.type,
        priority: 3,
        anchorId: expansion.anchorId,
        expanded: true,
      });
      visibleIds.add(id);
    });
    newestIds = candidates;
  }

  return { ...opening, scenePositions: positions, visibleIds, newestIds };
}

export function cameraForScene(scene, viewport, anchorIds = []) {
  const chosen = anchorIds.map((anchor) => (
    typeof anchor === 'string' ? scene.scenePositions.get(anchor) : anchor
  )).filter(Boolean);
  const points = chosen.length ? chosen : [...scene.scenePositions.values()];
  if (!points.length) return { x: 0, y: 0, scale: 1 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  // Portrait/nameplate extents are already reserved by the placement planner.
  // This smaller camera gutter keeps the newly opened group and its anchor in
  // one readable phone frame instead of clipping the relationship context.
  const width = Math.max(180, maxX - minX + 120);
  const height = Math.max(220, maxY - minY + 160);
  const mobile = viewport.width < 620;
  const scale = Math.max(mobile ? 0.76 : 0.68, Math.min(1, (viewport.width - 34) / width, (viewport.height - 170) / height));
  return {
    x: -((minX + maxX) / 2) * scale,
    y: -((minY + maxY) / 2) * scale + (mobile ? 22 : 28),
    scale,
  };
}

/** A deliberately art-directed family portrait, not a force simulation. */
export function createFocusLayout(graph, activeId, focusIds, viewport) {
  const mobile = viewport.width < 620;
  const cx = viewport.width / 2;
  const cy = viewport.height * (mobile ? 0.5 : 0.57);
  const rowGap = mobile ? 126 : 155;
  const available = viewport.width - (mobile ? 120 : 150);
  const positions = new Map([[activeId, { x: cx, y: cy, role: 'active', priority: 0 }]]);

  const idsIn = (items) => sortedIds(graph, items.map((x) => x.id).filter((id) => focusIds.has(id)));
  const partners = idsIn(graph.partners(activeId));
  const parents = idsIn(graph.parents(activeId));
  const children = idsIn(graph.children(activeId));
  const siblings = idsIn(graph.siblings(activeId));
  const grandparents = sortedIds(graph, parents.flatMap((id) => graph.parents(id).map((x) => x.id)).filter((id) => focusIds.has(id)));
  const grandchildren = sortedIds(graph, children.flatMap((id) => graph.children(id).map((x) => x.id)).filter((id) => focusIds.has(id)));

  const partnerGap = mobile ? 92 : 128;
  partners.forEach((id, index) => {
    const distance = Math.ceil((index + 1) / 2);
    const side = index % 2 === 0 ? 1 : -1;
    positions.set(id, { x: Math.max(54, Math.min(viewport.width - 54, cx + side * distance * partnerGap)), y: cy, role: 'partner', priority: 1 });
  });

  spread(parents.length, cx, mobile ? 112 : 170, available * 0.65).forEach((x, index) => {
    positions.set(parents[index], { x, y: cy - rowGap, role: 'parent', priority: 1 });
  });
  spread(children.length, cx, mobile ? 96 : 150, available).forEach((x, index) => {
    positions.set(children[index], { x, y: cy + rowGap, role: 'child', priority: 1 });
  });

  // Siblings share the active generation, but sit outside the partnership
  // portrait so they cannot be mistaken for partners.
  const podHalf = Math.max(80, Math.ceil(partners.length / 2) * partnerGap + 62);
  siblings.forEach((id, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const distance = Math.floor(index / 2);
    positions.set(id, {
      x: Math.max(56, Math.min(viewport.width - 56, cx + side * Math.min(available * 0.46, podHalf + 92 + distance * (mobile ? 74 : 105)))),
      y: cy + (mobile ? 34 : 48),
      role: 'sibling',
      priority: 2,
    });
  });

  spread(grandparents.length, cx, mobile ? 80 : 120, available * 0.8).forEach((x, index) => {
    positions.set(grandparents[index], { x, y: cy - rowGap * (mobile ? 1.65 : 1.55), role: 'grandparent', priority: 3 });
  });
  spread(grandchildren.length, cx, mobile ? 78 : 110, available * 0.85).forEach((x, index) => {
    positions.set(grandchildren[index], { x, y: cy + rowGap * (mobile ? 1.65 : 1.55), role: 'grandchild', priority: 3 });
  });

  // Any contextual partners/step-family still inside the budget become quiet
  // satellites close to the direct relative that introduced them.
  const placed = new Set(positions.keys());
  for (const id of focusIds) {
    if (placed.has(id)) continue;
    const anchor = directIds(graph, id).find((candidate) => positions.has(candidate));
    if (!anchor) continue;
    const a = positions.get(anchor);
    const h = hash(id);
    const side = h % 2 ? 1 : -1;
    positions.set(id, {
      x: Math.max(mobile ? 56 : 34, Math.min(viewport.width - (mobile ? 56 : 34), a.x + side * (mobile ? 68 : 92))),
      y: a.y + (h % 3 - 1) * (mobile ? 52 : 64),
      role: 'context',
      priority: 4,
    });
  }

  return { positions, centre: { x: cx, y: cy }, mobile };
}

/**
 * Promotes the selected person's visible neighbourhood from its stable atlas
 * coordinates into a freshly composed family portrait. Everyone else keeps
 * their accumulated world coordinate, so selection creates a clear foreground
 * without sacrificing the user's spatial history.
 */
export function recomposeLivingScene(graph, scene, activeId, viewport) {
  const mobile = viewport.width < 620;
  const planned = collectFocusIds(
    graph,
    activeId,
    mobile ? MAX_FOCUS_MOBILE : MAX_FOCUS_DESKTOP,
    { mobile },
  );
  const portraitIds = new Set([...planned].filter((id) => scene.visibleIds.has(id)));
  const portrait = createFocusLayout(graph, activeId, portraitIds, viewport);
  const scenePositions = new Map(scene.scenePositions);

  for (const [id, point] of portrait.positions) {
    scenePositions.set(id, {
      ...point,
      x: point.x - portrait.centre.x,
      y: point.y - portrait.centre.y,
      anchorId: activeId,
      staged: true,
    });
  }

  return { ...scene, scenePositions, portraitIds, portraitCentre: portrait.centre };
}

export function outsideConnections(graph, focusIds) {
  const result = new Map();
  for (const id of focusIds) {
    const outside = directIds(graph, id).filter((candidate) => !focusIds.has(candidate));
    if (outside.length) result.set(id, outside.length);
  }
  return result;
}

export function createAtlasModel(graph, activeId, viewport) {
  const atlas = createAtlasPositions(graph, viewport);
  const limit = viewport.width < 620 ? MAX_FOCUS_MOBILE : MAX_FOCUS_DESKTOP;
  const mobile = viewport.width < 620;
  const focusIds = collectFocusIds(graph, activeId, limit, { mobile });
  const focus = createFocusLayout(graph, activeId, focusIds, viewport);
  return {
    ...atlas,
    focusIds,
    focusPositions: focus.positions,
    centre: focus.centre,
    mobile: focus.mobile,
    outside: outsideConnections(graph, focusIds),
  };
}
