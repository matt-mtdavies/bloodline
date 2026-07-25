/*
 * Canonical gender storage: always lowercase ('male' | 'female' |
 * 'non-binary' | 'other'), matching the original convention used by
 * store.js's relationship-shortcut defaults (RELATIONSHIP_META) and every
 * seeded person. EditPersonSheet.jsx's and AddRelativeSheet.jsx's manual
 * gender pickers used to store their Title Case display labels
 * (GENDER_OPTIONS) verbatim instead — a real casing mismatch that silently
 * broke every exact `=== 'male'`/`=== 'female'` comparison downstream (the
 * Insights parenthood-age breakdown and GEDCOM export both did this,
 * confirmed against a real user report: a family's overall "average age
 * becoming a parent" didn't match its own Mothers/Fathers sub-averages,
 * because anyone whose gender had ever been set via Edit Profile was
 * silently excluded from the gender breakdown while still counting toward
 * the overall figure). Every comparison site now normalizes through this
 * file rather than relying on casing alone — this fixes it for already-
 * stored Title Case records too, no data migration needed.
 */
export function normalizeGender(g) {
  const s = String(g || '').trim().toLowerCase();
  return s || null;
}

// Title Case for display, regardless of how the value happens to be stored
// (old records may still be Title Case from before this fix; new ones are
// always lowercase) — 'non-binary' -> 'Non-binary', 'male' -> 'Male'.
export function genderLabel(g) {
  const s = normalizeGender(g);
  if (!s) return '';
  return s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}
