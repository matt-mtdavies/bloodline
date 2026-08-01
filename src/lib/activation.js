/*
 * Fire-and-forget client for the aggregate activation-funnel telemetry
 * (docs/PRODUCTIZATION-BRIEF.md §11.7 / §12 Phase B): public CTA click,
 * path chosen, onboarding completion, first tree created/import completed,
 * invitation accepted, first meaningful contribution. Never carries a
 * family id, person id, email, or any other identifying/free-text content
 * — see functions/api/activation-event.js, which enforces the same
 * allowlist server-side regardless of what's passed here.
 *
 * Deliberately never awaited by callers, and never throws — a slow,
 * blocked, or failed telemetry write must be invisible to the user and
 * must never delay or break the real action it's describing.
 */
const ENDPOINT = '/api/activation-event';

export function trackActivation(event, path) {
  try {
    const body = JSON.stringify(path ? { event, path } : { event });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    // sendBeacon unavailable or its own internal queue rejected the send
    // (e.g. payload too large, which can't happen here, but browsers don't
    // guarantee acceptance) — fall back to a plain, non-blocking fetch.
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* telemetry must never throw into the caller */ }
}
