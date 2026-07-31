/*
 * Shared "ripple" reveal scheduler — bubbles reveal outward in real BFS-
 * distance layers (everyone one hop out, then two hops, and so on) with
 * adaptive per-step timing that converges on a target wall-clock duration
 * regardless of how much real per-step overhead (spawning sprites, the
 * force sim re-registering nodes) a given reveal turns out to cost.
 *
 * Extracted from App.jsx's `toggleExpandAll` (the "All" dock button's own
 * crash-prevention fix — dumping hundreds of bubbles into one synchronous
 * React state update could freeze/crash the tab) so the SAME crash-safety
 * pacing can be reused for Family Perimeter's initial working-set reveal
 * (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md §10 Phase 4) —
 * revealing a saved perimeter's worth of people on first load is exactly
 * the same "many bubbles becoming visible at once" risk "All" already had
 * to solve, just triggered automatically instead of by a tap.
 *
 * Pure aside from `setTimeout`/`Date.now()` — no React, no DOM, so this is
 * unit-testable directly.
 */

// A single BFS layer (a whole generation band, say) can still be far bigger
// than is safe to spawn in one frame — this caps how many bubbles ever
// materialize in a single tick.
export const RIPPLE_CHUNK_SIZE = 40;
// The whole reveal should feel like a ripple growing outward from whatever's
// already visible, not an arbitrary dump — and should settle within a
// couple of seconds regardless of how many BFS layers a given family
// happens to have. RIPPLE_TOTAL_MS is a target the scheduler continuously
// re-aims for against the real clock, not a delay computed once upfront.
export const RIPPLE_TOTAL_MS = 2200;
export const RIPPLE_MIN_LAYER_MS = 70;
export const RIPPLE_MAX_LAYER_MS = 260;
// Between sub-chunks of the SAME layer (only relevant when a layer is bigger
// than RIPPLE_CHUNK_SIZE) — a tighter range than the inter-layer one, kept
// fast so a big generation band still reads as one continuous wave filling
// in, not a series of stutters.
export const RIPPLE_MIN_SUBCHUNK_MS = 25;
export const RIPPLE_MAX_SUBCHUNK_MS = 70;

/*
 * Splits `targetIds` (minus anything already in `alreadyVisible`) into BFS
 * distance layers using `distMap` (a Map<id, hopDistance>, e.g. from
 * graph.js's distancesFrom/distancesFromMany), then chunks each layer to
 * RIPPLE_CHUNK_SIZE. Pure — no scheduling here, just the grouping step
 * scheduleStaggeredReveal below drives; exported separately so tests (and
 * any caller that wants the raw step plan without actually scheduling it)
 * can inspect it directly.
 */
export function planRevealSteps(targetIds, distMap, alreadyVisible) {
  const byDistance = new Map();
  for (const id of targetIds) {
    if (alreadyVisible.has(id)) continue;
    const d = distMap.get(id) ?? Infinity;
    if (!byDistance.has(d)) byDistance.set(d, []);
    byDistance.get(d).push(id);
  }
  const layers = [...byDistance.keys()].sort((a, b) => a - b).map((d) => byDistance.get(d));
  const steps = [];
  layers.forEach((layerIds, layerIndex) => {
    const chunkCount = Math.ceil(layerIds.length / RIPPLE_CHUNK_SIZE);
    for (let j = 0, c = 0; j < layerIds.length; j += RIPPLE_CHUNK_SIZE, c++) {
      const chunk = layerIds.slice(j, j + RIPPLE_CHUNK_SIZE);
      const isLayerEnd = c === chunkCount - 1;
      steps.push({ ids: chunk, isLayerEnd, weight: isLayerEnd ? 1 + layerIndex * 0.05 : 0.25 });
    }
  });
  return steps;
}

/*
 * Schedules the reveal: calls `onBatch(ids)` once per step, timed so the
 * whole sequence converges on RIPPLE_TOTAL_MS. Returns a `cancel()`
 * function (safe to call even after the reveal finishes on its own).
 *
 * `instant: true` (reduced-motion) skips all scheduling and calls
 * `onBatch` once with every remaining id — "dampen/shorten, don't
 * eliminate" would still leave a multi-second reveal for someone who
 * explicitly asked to reduce motion, so this one goes all the way to
 * immediate, matching flyToSearchResult's own reduced-motion handling.
 */
export function scheduleStaggeredReveal(targetIds, distMap, alreadyVisible, onBatch, { instant = false } = {}) {
  const steps = planRevealSteps(targetIds, distMap, alreadyVisible);
  if (!steps.length) return () => {};

  if (instant) {
    onBatch(steps.flatMap((s) => s.ids));
    return () => {};
  }

  const totalWeight = steps.reduce((s, st) => s + st.weight, 0);
  const t0 = Date.now();
  let idx = 0;
  let remainingWeight = totalWeight;
  let timer = null;

  const next = () => {
    const step = steps[idx++];
    remainingWeight -= step.weight;
    onBatch(step.ids);
    if (idx < steps.length) {
      const remainingBudget = Math.max(0, RIPPLE_TOTAL_MS - (Date.now() - t0));
      const nextWeight = steps[idx].weight;
      const rawGap = remainingWeight > 0 ? (remainingBudget * nextWeight) / remainingWeight : RIPPLE_MIN_LAYER_MS;
      const [gapMin, gapMax] = steps[idx].isLayerEnd
        ? [RIPPLE_MIN_LAYER_MS, RIPPLE_MAX_LAYER_MS]
        : [RIPPLE_MIN_SUBCHUNK_MS, RIPPLE_MAX_SUBCHUNK_MS];
      timer = setTimeout(next, Math.min(gapMax, Math.max(gapMin, rawGap)));
    } else {
      timer = null;
    }
  };
  next();

  return () => { if (timer) clearTimeout(timer); };
}
