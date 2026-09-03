/*
 * Feature flag for the Atlas prototype.
 *
 *   ?lab=atlas   opens the Atlas lab INSTEAD of the app.
 *
 * Same isolation contract as the Tree Motion Lab and the Focus Layer lab
 * (see main.jsx): a separate lazy chunk, never reached by an ordinary
 * visitor, and it never imports src/data/store.js — so it cannot write, sync,
 * or migrate anything. Its one deliberate exception is the same strictly
 * opt-in, strictly read-only GET to /api/tree those labs already use
 * (src/viz/v2/realFamily.js), fired only by an explicit button press, so the
 * whole-family layout question can be judged against a real 1,000+ person
 * tree rather than a fixture. Closing the URL is the whole rollback.
 */

export const ATLAS_LAB_VALUE = 'atlas';

export function isAtlasLabOpen() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('lab') === ATLAS_LAB_VALUE;
}
