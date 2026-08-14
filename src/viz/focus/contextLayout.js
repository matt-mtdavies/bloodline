/*
 * The Context Layer — the whole tree, as texture.
 *
 * This layout has NO legibility duty. Nobody reads a name in it; it exists so
 * that the focus layer has somewhere to lift FROM, and so you can still see the
 * shape of the family you were navigating. That freedom is what makes it cheap:
 * a generation-banded pack with families kept adjacent, computed once, drawn
 * once to a canvas, never animated per-node. No simulation, no drift, no
 * per-frame cost at any tree size.
 *
 * Deliberately deterministic (no Math.random) so the backdrop is identical
 * between renders — a backdrop that reshuffles would undercut the sense that
 * the focus layer lifted out of something real.
 */

import { computeGenerations } from '../../data/graph.js';

export const CTX_ROW = 90;
export const CTX_GAP = 34;

/**
 * Order people so that families land next to each other: walk the eldest
 * generation in a stable order, then depth-first through partners and
 * children. Anyone unreachable that way is appended in id order, so every
 * person is placed exactly once regardless of how disconnected the tree is.
 */
function familyOrder(graph) {
  const seen = new Set();
  const order = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const p of graph.partners(id)) visit(p.id);
    for (const c of [...graph.children(id)].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      visit(c.id);
    }
  };
  const roots = graph.people
    .filter((p) => graph.parents(p.id).length === 0)
    .map((p) => p.id)
    .sort();
  for (const id of roots) visit(id);
  for (const p of [...graph.people].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    visit(p.id);
  }
  return order;
}

/**
 * @returns {{ positions: Map<string,{x,y}>, bounds: {minX,maxX,minY,maxY,width,height} }}
 *   World coordinates centred on nothing in particular — the caller fits them.
 */
export function planContext(graph) {
  const gens = computeGenerations(graph);
  const order = familyOrder(graph);
  const slots = new Map(); // generation → running count
  const positions = new Map();
  const rowsOf = new Map();

  for (const id of order) {
    const g = gens.get(id) ?? 0;
    const i = slots.get(g) ?? 0;
    slots.set(g, i + 1);
    if (!rowsOf.has(g)) rowsOf.set(g, []);
    rowsOf.get(g).push(id);
  }

  const widest = Math.max(1, ...[...rowsOf.values()].map((r) => r.length));
  for (const [g, ids] of rowsOf) {
    // Centre every row on the same axis so the whole tree reads as one mass
    // rather than a left-aligned staircase.
    const span = (ids.length - 1) * CTX_GAP;
    ids.forEach((id, i) => positions.set(id, { x: -span / 2 + i * CTX_GAP, y: g * CTX_ROW }));
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!positions.size) return { positions, bounds: null, widest };
  return {
    positions,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX || 1, height: maxY - minY || 1 },
    widest,
  };
}
