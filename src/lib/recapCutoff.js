/*
 * Recap cutoff — client-side fetch helpers for the per-user "seen up to"
 * marker for the recap tour (functions/_lib/familyMemberRecap.js). The
 * localStorage copy (src/data/store.js's takeRecapCutoff/setRecapCutoff)
 * stays the fast, synchronous, offline-first value used at every boot —
 * these exist purely to reconcile it with the server so the SAME cutoff is
 * honored across every device a member uses, not just whichever one it was
 * last advanced on. Same shape as src/lib/familyPerimeter.js's fetch pair.
 */

export async function fetchRecapCutoff() {
  const res = await fetch('/api/user/recap-cutoff');
  if (res.status === 503) return { unavailable: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { cutoffAt: number|null }
}

// Deliberately fire-and-forget / non-fatal — matches
// planPerimeterRecommendationIfUnset's own convention. A network hiccup
// here must never block login or the recap tour itself; the localStorage
// value already advanced locally either way, and the next successful sync
// (next login, or the next time markRecapSeen fires) will catch it up.
export async function pushRecapCutoff(cutoffAt) {
  try {
    const res = await fetch('/api/user/recap-cutoff', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cutoffAt }),
    });
    if (!res.ok) return null;
    return await res.json(); // { cutoffAt } — the ratcheted final value
  } catch {
    return null;
  }
}
