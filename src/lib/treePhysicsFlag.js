/*
 * Feature flag for the tree physics experiment.
 *
 * Two independent switches, deliberately separate:
 *
 *   ?lab=tree-motion   opens the Tree Motion Lab instead of the app. The lab is
 *                      FIXTURE-ONLY — it never loads, reads or writes a real
 *                      family — so nothing it does can touch anyone's data.
 *   ?treePhysics=v2    selects the experimental engine INSIDE the lab.
 *
 * V1 is the default everywhere and is the only engine the real app ever uses:
 * `isV2Enabled()` is not consulted outside the lab, so there is no code path in
 * which V2 renders production data. Recovering the production behaviour is
 * therefore not a deploy or a flag flip — it is closing the lab URL.
 *
 * A localStorage override exists so a reviewer can keep the lab pinned to one
 * engine across reloads while recording comparisons; the query parameter always
 * wins over it, so a shared link is unambiguous.
 */

export const LAB_PARAM = 'lab';
export const LAB_VALUE = 'tree-motion';
export const PHYSICS_PARAM = 'treePhysics';
export const PHYSICS_STORAGE_KEY = 'bl_tree_physics';

function search() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** True only when the lab has been explicitly opened by URL. */
export function isLabOpen() {
  return search().get(LAB_PARAM) === LAB_VALUE;
}

/** 'v1' | 'v2' — v1 unless explicitly asked otherwise. */
export function treePhysicsVersion() {
  const q = search().get(PHYSICS_PARAM);
  if (q === 'v2' || q === 'v1') return q;
  try {
    const stored = window.localStorage?.getItem(PHYSICS_STORAGE_KEY);
    if (stored === 'v2' || stored === 'v1') return stored;
  } catch { /* private mode / storage disabled — fall through to the default */ }
  return 'v1';
}

export function setStoredPhysicsVersion(v) {
  try {
    if (v === 'v1' || v === 'v2') window.localStorage?.setItem(PHYSICS_STORAGE_KEY, v);
    else window.localStorage?.removeItem(PHYSICS_STORAGE_KEY);
  } catch { /* nothing to recover from — the flag is a convenience, not state */ }
}

export const isV2Enabled = () => treePhysicsVersion() === 'v2';
