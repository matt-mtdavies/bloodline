/*
 * Reduces parent-child line crossings in the organic/hybrid layouts by
 * reordering bubbles WITHIN each generation band — the classic barycenter
 * heuristic from layered graph drawing (Sugiyama-style tree/DAG rendering):
 * each unit's target slot is nudged toward the average slot of its
 * connections in the band above, then the band below, repeated a few
 * passes until the order settles. Couples move as a single unit so a
 * partner pod never gets split apart mid-reorder.
 *
 * Deliberately NOT a physics force of its own — it's a one-shot ordering
 * pass, recomputed only when the visible set actually changes (see
 * BubbleTree's frameBody), whose result feeds the existing gentle forceX
 * as a target. The simulation still eases bubbles into place exactly as
 * before; this only changes WHERE they ease to, so couple pods, merged
 * parent trunks and step-dashed lines all keep rendering exactly as they
 * did — they only ever read current node x/y, never how a node got there.
 */

const SOLO_SLOT = 170;
const COUPLE_SLOT = 260;
const SWEEPS = 3;

export function computeUncrossedXTargets(graph, visibleIds, layoutGenFn, currentX) {
  const result = new Map();
  if (!visibleIds || visibleIds.size === 0) return result;

  // 1. Fold each visible couple (same band) into one reorder-unit.
  const claimed = new Set();
  const unitOf = new Map(); // personId -> unit
  const bands = new Map(); // gen -> unit[]
  for (const id of visibleIds) {
    if (claimed.has(id)) continue;
    const g = layoutGenFn(id);
    // Only a CURRENT or widowed partner renders as a physically-adjacent pod
    // (see links.js) — a former/divorced partner gets a separate, deliberately
    // NOT-adjacent dashed treatment, so pairing with one here would fight the
    // real pod's adjacency (exactly what happened when James ended up
    // grouped with his ex instead of his current partner, since she simply
    // came first in the relationships array).
    const partner = graph.partners(id).find(
      (p) => p.status !== 'former' && visibleIds.has(p.id) && !claimed.has(p.id) && layoutGenFn(p.id) === g,
    );
    const unit = partner ? { ids: [id, partner.id], gen: g } : { ids: [id], gen: g };
    claimed.add(id);
    if (partner) claimed.add(partner.id);
    for (const uid of unit.ids) unitOf.set(uid, unit);
    if (!bands.has(g)) bands.set(g, []);
    bands.get(g).push(unit);
  }

  // 2. Seed each band's order from current on-screen x, so the first pass
  // roughly matches what's already there — later re-runs then only nudge
  // order where connectivity actually wants it, instead of reshuffling
  // everything every time one more person is revealed.
  const unitX = (u) => u.ids.reduce((s, id) => s + (currentX(id) ?? 0), 0) / u.ids.length;
  for (const list of bands.values()) list.sort((a, b) => unitX(a) - unitX(b));

  const indexOf = new Map(); // personId -> index within its own band
  const reindex = () => {
    for (const list of bands.values()) {
      list.forEach((u, i) => { for (const id of u.ids) indexOf.set(id, i); });
    }
  };
  reindex();

  const gensAscending = [...bands.keys()].sort((a, b) => a - b);

  // direction 1: reorder using the band ABOVE (parents). direction -1: below (children).
  const barycenterPass = (direction) => {
    const order = direction === 1 ? gensAscending : [...gensAscending].reverse();
    for (const g of order) {
      const list = bands.get(g);
      const neighbourGen = direction === 1 ? g - 1 : g + 1;
      if (!bands.has(neighbourGen)) continue;
      const scored = list.map((u, orig) => {
        const neighbourIdx = [];
        for (const id of u.ids) {
          const neighbours = direction === 1 ? graph.parents(id) : graph.children(id);
          for (const n of neighbours) {
            if (indexOf.has(n.id) && unitOf.get(n.id)?.gen === neighbourGen) {
              neighbourIdx.push(indexOf.get(n.id));
            }
          }
        }
        const bary = neighbourIdx.length
          ? neighbourIdx.reduce((s, v) => s + v, 0) / neighbourIdx.length
          : null;
        return { u, bary, orig };
      });
      // Units with no connection into that band keep their current relative
      // order (fall back to their existing index) rather than collapsing to
      // one end — only units that actually have somewhere to be pulled move.
      scored.sort((a, b) => (a.bary ?? a.orig) - (b.bary ?? b.orig) || a.orig - b.orig);
      bands.set(g, scored.map((s) => s.u));
    }
    reindex();
  };

  for (let i = 0; i < SWEEPS; i++) {
    barycenterPass(1);
    barycenterPass(-1);
  }

  // 2b. Transpose pass — barycenter averaging is only a heuristic and can
  // settle into an order that's locally worse than a simple adjacent swap
  // would be (this bit it in practice: a divorced co-parent's shared kids,
  // or a partner whose OWN ancestry is a different generation depth than
  // their spouse's, both pull the barycenter average in misleading
  // directions). This is the standard companion step: for every adjacent
  // pair in a band, actually count crossings against both neighbour bands
  // in the current vs swapped order, and swap whenever that strictly helps.
  // Bounded (a handful of full passes, stops as soon as nothing improves)
  // so it can't loop or fight the barycenter passes.
  const neighbourIdxs = (unit, direction, neighbourGen) => {
    const idxs = [];
    for (const id of unit.ids) {
      const neighbours = direction === 1 ? graph.parents(id) : graph.children(id);
      for (const n of neighbours) {
        if (indexOf.has(n.id) && unitOf.get(n.id)?.gen === neighbourGen) idxs.push(indexOf.get(n.id));
      }
    }
    return idxs;
  };
  const crossingsFor = (aIdxs, bIdxs, aBeforeB) => {
    let n = 0;
    for (const ai of aIdxs) for (const bi of bIdxs) {
      if (aBeforeB ? ai > bi : ai < bi) n++;
    }
    return n;
  };
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const g of gensAscending) {
      const list = bands.get(g);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1];
        let current = 0, swapped = 0;
        for (const [dir, ng] of [[1, g - 1], [-1, g + 1]]) {
          if (!bands.has(ng)) continue;
          const aIdxs = neighbourIdxs(a, dir, ng);
          const bIdxs = neighbourIdxs(b, dir, ng);
          current += crossingsFor(aIdxs, bIdxs, true);
          swapped += crossingsFor(aIdxs, bIdxs, false);
        }
        if (swapped < current) {
          list[i] = b; list[i + 1] = a;
          indexOf.set(a.ids[0], i + 1); if (a.ids[1]) indexOf.set(a.ids[1], i + 1);
          indexOf.set(b.ids[0], i); if (b.ids[1]) indexOf.set(b.ids[1], i);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // 3. Final order -> x-pixel targets, each band centred on 0 (the existing
  // weak forceX/charge balance still governs overall left-right centring
  // and breathing room; this only fixes relative order within a row).
  for (const list of bands.values()) {
    const widths = list.map((u) => (u.ids.length === 2 ? COUPLE_SLOT : SOLO_SLOT));
    const total = widths.reduce((s, w) => s + w, 0);
    let cursor = -total / 2;
    list.forEach((u, i) => {
      const w = widths[i];
      const center = cursor + w / 2;
      cursor += w;
      if (u.ids.length === 2) {
        result.set(u.ids[0], center - 56);
        result.set(u.ids[1], center + 56);
      } else {
        result.set(u.ids[0], center);
      }
    });
  }

  return result;
}
