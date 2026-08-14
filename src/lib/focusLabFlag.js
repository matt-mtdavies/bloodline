/*
 * Feature flag for the Focus Layer prototype.
 *
 *   ?lab=focus   opens the Focus Layer lab INSTEAD of the app.
 *
 * Same isolation contract as the Tree Motion Lab (see main.jsx): the lab is a
 * separate lazy chunk, never reached by an ordinary visitor, and it never
 * imports src/data/store.js — so it cannot write, sync, or migrate anything.
 * Its one deliberate exception is the same strictly opt-in, strictly read-only
 * GET to /api/tree the motion lab already uses (src/viz/v2/realFamily.js),
 * fired only by an explicit button press, so the layout question can be judged
 * against a real family rather than a fixture. Closing the URL is the whole
 * rollback.
 */

export const FOCUS_LAB_VALUE = 'focus';

export function isFocusLabOpen() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('lab') === FOCUS_LAB_VALUE;
}
