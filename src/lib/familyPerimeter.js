/*
 * Family Perimeter — client-side option metadata + thin fetch helpers for
 * the per-user preference (docs/FAMILY-PERIMETER-AND-5000-PERSON-
 * PERFORMANCE.md §3.1/§9.2, Phase 3). This is deliberately UI/persistence
 * only: nothing here reads or filters the tree yet — the saved level is
 * stored and displayed, but doesn't change what's rendered until Phase 4
 * ("Tree perimeter experience") wires src/lib/perspectiveIndex.js's
 * `perimeterLevel` option up to it. The server's own string levels
 * (first/second/third/everyone, matching functions/_lib/
 * familyMemberPreference.js) are kept as-is here rather than translated to
 * perspectiveIndex.js's numeric 1/2/3/'everyone' convention — that mapping
 * belongs to whichever Phase 4 code actually calls computePerspectiveIndex.
 */

// Copy matches §3.1 verbatim.
export const PERIMETER_OPTIONS = [
  { value: 'first', label: 'Close family', description: 'Through 1st cousins' },
  { value: 'second', label: 'Extended family', description: 'Through 2nd cousins' },
  { value: 'third', label: 'Wider family', description: 'Through 3rd cousins' },
  { value: 'everyone', label: 'Complete family tree', description: 'Everyone' },
];

// §3.1: "New users should be offered Extended family as the recommended
// starting point after they claim their own person."
export const RECOMMENDED_LEVEL_FOR_NEW_USERS = 'second';

export async function fetchPerimeterPreference() {
  const res = await fetch('/api/user/perimeter');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { perimeterLevel, hasSavedPreference, unclaimed? }
}

export async function savePerimeterPreference(level) {
  const res = await fetch('/api/user/perimeter', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/*
 * Plants the new-user recommendation (§3.1) the instant someone claims
 * their own person for the first time — see functions/_lib/
 * familyMemberPreference.js's setFamilyMemberPreference doc comment for why
 * `ifUnset` is safe to call unconditionally here: an existing user who
 * claimed their person long before this feature shipped already has no
 * saved row either, but they aren't the ones calling this (they aren't
 * re-claiming), so their preference correctly stays absent → 'everyone'.
 * Deliberately fire-and-forget / non-fatal, matching the same convention
 * the claim action itself already uses (a network hiccup here must never
 * block or roll back the claim, which already applies locally either way).
 */
export async function planPerimeterRecommendationIfUnset() {
  try {
    await fetch('/api/user/perimeter', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: RECOMMENDED_LEVEL_FOR_NEW_USERS, ifUnset: true }),
    });
  } catch { /* non-fatal — see doc comment above */ }
}
