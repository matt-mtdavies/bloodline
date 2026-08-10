/*
 * Feature flag for the browse-density experiment — OFF unless asked for.
 *
 * The problem it exists to test: ordinary browsing never gives anything back.
 * Every tap adds an anchor to `expanded` and no path removes one, so the
 * canvas only ever gets denser. Measured by walking the real 1,239-person
 * tree relative-by-relative: 11 people on screen at rest, 27 after ten taps,
 * 67 after twenty-five — against a phone that can legibly show about fifteen.
 * It never came back down, because nothing ever took anything away.
 *
 *   ?browseBound=on    bound the working set while browsing
 *   ?browseBound=off   today's behaviour (the default)
 *
 * Default OFF is the whole point: with the flag unset, App.jsx takes exactly
 * the same code path it always has, so this can be deployed and looked at on a
 * real family without changing the tree for anyone who hasn't opted in.
 * Recovering current behaviour is dropping the query parameter — not a deploy,
 * not a rollback.
 *
 * A localStorage override exists so the setting survives reloads while you're
 * comparing (a tree is judged over minutes of browsing, not one screenshot);
 * the query parameter always wins over it, so a shared link is unambiguous.
 */

export const BROWSE_BOUND_PARAM = 'browseBound';
export const BROWSE_BOUND_STORAGE_KEY = 'bl_browse_bound';

function search() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** True only when the experiment has been explicitly switched on. */
export function isBrowseBoundEnabled() {
  const q = search().get(BROWSE_BOUND_PARAM);
  if (q === 'on') return true;
  if (q === 'off') return false;
  try {
    return window.localStorage?.getItem(BROWSE_BOUND_STORAGE_KEY) === 'on';
  } catch {
    // private mode / storage disabled — fall through to the safe default
    return false;
  }
}

/** Persist the choice so a browsing session survives reloads. Called once at
 *  startup when (and only when) the query parameter is present, so arriving
 *  with ?browseBound=on keeps it on until you explicitly turn it off. */
export function rememberBrowseBoundChoice() {
  const q = search().get(BROWSE_BOUND_PARAM);
  if (q !== 'on' && q !== 'off') return;
  try {
    window.localStorage?.setItem(BROWSE_BOUND_STORAGE_KEY, q);
  } catch { /* storage disabled — the query parameter still governs this load */ }
}

/*
 * How many ANCHORS the canvas keeps while browsing. Each anchor drags in its
 * own immediate family (~6.6 people on average across the real tree, 29 at
 * worst), so this is deliberately a count of anchors rather than of people.
 *
 * Chosen by measurement, not taste. Walking the real tree for twenty-five
 * taps, the canvas settles at 17 people with a cap of 5 and 22 with a cap of
 * 6, against 67 with no cap at all; 8 and above drift back out of budget. A
 * phone fits roughly 4.7 bubbles across at a readable size, so ~15 people is
 * the honest ceiling there. Desktop is about 3x wider, so it keeps more of
 * the trail behind you.
 */
export const MAX_BROWSE_ANCHORS_PHONE = 5;
export const MAX_BROWSE_ANCHORS_DESKTOP = 10;
export const PHONE_MAX_WIDTH = 700;

export function maxBrowseAnchorsFor(viewportWidth) {
  return viewportWidth <= PHONE_MAX_WIDTH ? MAX_BROWSE_ANCHORS_PHONE : MAX_BROWSE_ANCHORS_DESKTOP;
}
