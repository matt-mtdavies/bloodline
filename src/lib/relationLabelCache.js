/*
 * Search's perimeter-aware relationship line (Phase 5 §3.8) needs
 * relationLabel(graph, viewerId, id, kinTerms) for every VISIBLE search row
 * — but that runs on every render (cursor movement, hover, unrelated state
 * changes), and for a distant person relationLabel can walk two ancestor
 * traversals. At a 5,000-person baseline that's exactly the avoidable
 * main-thread work the performance plan exists to cut (Codex review, PR #90
 * P2).
 *
 * getCachedRelationLabel memoizes per personId in a caller-owned Map. The
 * caller owns invalidation: hand in a FRESH Map whenever graph/viewerId/
 * kinTerms genuinely change identity (e.g. via useMemo keyed on those three,
 * the same convention lib/search.js's personSearchCache WeakMap already
 * uses for per-person fields) — this function only owns the cheap per-row
 * lookup, not the invalidation policy.
 */
import { relationLabel } from '../data/graph.js';

export function getCachedRelationLabel(cache, graph, focusId, otherId, kinTerms) {
  let cached = cache.get(otherId);
  if (cached === undefined) {
    cached = relationLabel(graph, focusId, otherId, kinTerms);
    cache.set(otherId, cached);
  }
  return cached;
}
