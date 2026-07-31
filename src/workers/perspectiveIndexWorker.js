/*
 * Family Perimeter — off-main-thread wrapper around
 * src/lib/perspectiveIndex.js (docs/FAMILY-PERIMETER-AND-5000-PERSON-
 * PERFORMANCE.md §6.6/§10 Phase 2 "worker execution" deliverable, and the
 * §7 "Perimeter calculation in worker" budget).
 *
 * Deliberately NOT imported or wired into the app yet — Phase 2 is scoped
 * to the pure engine + this worker-execution wrapper existing and being
 * directly usable; deciding WHEN to hand a calculation to this worker
 * (vs. the main thread) is a UI/store integration decision that belongs to
 * a later phase (§10 Phase 4+), same as `lib/cinematicTimeline.js`'s own
 * "pure compiler, not wired into the app yet" Phase 0 scoping.
 *
 * Usage (once a future phase wires this in):
 *   const worker = new Worker(new URL('./perspectiveIndexWorker.js', import.meta.url), { type: 'module' });
 *   worker.postMessage({ people, relationships, viewerId, perimeterLevel, bloodlineOnly, temporaryRevealIds });
 *   worker.onmessage = (e) => { if (e.data.ok) use(e.data.result); else handle(e.data.error); };
 *
 * `people`/`relationships` are sent as plain arrays (postMessage-cloneable —
 * they're already the raw store shape), NOT a prebuilt graph object (a
 * graph's `parents`/`children`/`partners`/`siblings` are closures over
 * functions, which the structured clone algorithm cannot transfer). The
 * worker rebuilds the graph locally via buildGraph. The result's Sets/Maps
 * ARE structured-cloneable as-is, so `computePerspectiveIndex`'s output is
 * posted back unmodified — no flattening to arrays/objects needed.
 */
import { buildGraph } from '../data/graph.js';
import { computePerspectiveIndex } from '../lib/perspectiveIndex.js';

self.onmessage = (e) => {
  const { people, relationships, viewerId, perimeterLevel, bloodlineOnly, temporaryRevealIds, requestId } = e.data || {};
  try {
    const graph = buildGraph(people || [], relationships || []);
    const result = computePerspectiveIndex(graph, { viewerId, perimeterLevel, bloodlineOnly, temporaryRevealIds });
    self.postMessage({ ok: true, requestId, result });
  } catch (err) {
    self.postMessage({ ok: false, requestId, error: err?.message || String(err) });
  }
};
