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

// A 503 (family_member_preference table not yet migrated in this
// environment) is a distinct, expected state — not a bug the caller should
// report as a generic error string. Both fetch helpers surface it as
// `{ unavailable: true }` / a thrown Error with `.unavailable = true` so
// the UI can render a clear, honest "not available yet" message (§3.2's
// Phase 3 "failure falls back safely and visibly" exit criterion) instead
// of silently showing nothing or a confusing raw error.
export async function fetchPerimeterPreference() {
  const res = await fetch('/api/user/perimeter');
  if (res.status === 503) return { unavailable: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { perimeterLevel, hasSavedPreference, isRecommendation, unclaimed? }
}

export async function savePerimeterPreference(level) {
  const res = await fetch('/api/user/perimeter', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
  });
  if (res.status === 503) {
    const e = new Error('Family Perimeter isn’t available right now.');
    e.unavailable = true;
    throw e;
  }
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
