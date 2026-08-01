/*
 * "Care for your archive" notification-seen tracking — a small, separate
 * concept from dismissal (lib/duplicates.js / lib/integrity.js). Dismissing
 * an item means "this isn't really a problem, stop showing it." Seeing an
 * item just means "I've already had a chance to notice this exists" — it
 * still shows in the workspace, but no longer counts as NEW for the
 * topbar's notification dot (premium-UX brief: "show a notification
 * indicator only when newly discovered review items exist; do not
 * permanently badge the raw total").
 */
const SEEN_KEY = 'bl_archivecare_seen';

export function loadSeenArchiveCareKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}

export function saveSeenArchiveCareKeys(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

/** True if at least one of `keys` is not yet in `seenKeys`. */
export function hasUnseenKeys(keys, seenKeys) {
  return keys.some((k) => !seenKeys.has(k));
}
