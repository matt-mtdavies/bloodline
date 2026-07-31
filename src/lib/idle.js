/*
 * requestIdleCallback wrapper — Safari/WebKit has never implemented it (see
 * this repo's own WebKit-testing convention in CLAUDE.md), so every caller
 * needs the same setTimeout fallback; centralized here instead of repeated
 * per call site. Used to defer genuinely expensive-but-not-urgent
 * computations (duplicate detection, ambient insight highlights) off the
 * synchronous render/commit path — see docs/FAMILY-PERIMETER-AND-5000-PERSON-
 * PERFORMANCE.md §10 Phase 1, "lazy/idle duplicate detection" and "insight
 * computation only when needed".
 */
const FALLBACK_DELAY_MS = 1; // setTimeout(fn, 0) still yields a frame; matches rIC's own intent

export function scheduleIdle(fn, { timeout } = {}) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, timeout != null ? { timeout } : undefined);
    return { kind: 'idle', id };
  }
  const id = setTimeout(fn, FALLBACK_DELAY_MS);
  return { kind: 'timeout', id };
}

export function cancelIdle(handle) {
  if (!handle) return;
  if (handle.kind === 'idle' && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(handle.id);
  } else {
    clearTimeout(handle.id);
  }
}
