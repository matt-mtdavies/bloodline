import { computeGenerations } from '../../data/graph.js';

export const MAX_FOCUS_DESKTOP = 30;
export const MAX_FOCUS_MOBILE = 8;

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
