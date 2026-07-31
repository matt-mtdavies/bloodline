/*
 * Lightweight, opt-in timing instrumentation around the app's expensive
 * pipeline stages (buildGraph, computeInsightModules, findDuplicatePairs,
 * store serialization) — Phase 1 performance relief (docs/FAMILY-PERIMETER-
 * AND-5000-PERSON-PERFORMANCE.md §10, "instrumentation around the current
 * pipeline"). Off by default in production: Vite dev mode enables it
 * automatically; production only turns it on if someone deliberately asks
 * for it (?perfdebug in the URL, persisted to localStorage so it survives a
 * follow-up navigation) — so a real large family's actual slowness can be
 * diagnosed without needing a new build. Never throws and never changes a
 * wrapped call's return value — broken instrumentation must never break the
 * thing it's measuring.
 */
let cachedEnabled = null;
export function perfInstrumentEnabled() {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      cachedEnabled = true;
      return true;
    }
    if (typeof window === 'undefined') {
      cachedEnabled = false;
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('perfdebug')) {
      localStorage.setItem('bloodline:perfdebug', '1');
      cachedEnabled = true;
      return true;
    }
    cachedEnabled = localStorage.getItem('bloodline:perfdebug') === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

// ~ half a 60fps frame budget — only stages actually worth noticing get
// logged, so enabling this doesn't flood the console with sub-millisecond
// noise on every render.
const THRESHOLD_MS = 8;

export function timed(label, fn) {
  if (!perfInstrumentEnabled()) return fn();
  const t0 = performance.now();
  const result = fn();
  const elapsed = performance.now() - t0;
  if (elapsed >= THRESHOLD_MS) {
    // eslint-disable-next-line no-console
    console.debug(`[perf] ${label}: ${elapsed.toFixed(1)}ms`);
  }
  return result;
}
