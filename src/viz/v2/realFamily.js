/*
 * Loads the CURRENT logged-in browser session's real family tree into the
 * Tree Motion Lab — strictly opt-in (only ever called from a deliberate
 * button press, never on mount) and strictly READ-ONLY: one GET to the
 * same /api/tree endpoint the real app already reads from, riding
 * whatever session cookie is already set in this browser. This module
 * never imports src/data/store.js and never issues any other request —
 * no PUT, no sync, no polling, no localStorage — so there is no path by
 * which opening the lab and clicking "Load your real family" can write
 * anything back. See main.jsx's own comment on the lab's normal
 * fixture-only isolation for why that boundary exists and matters here.
 *
 * Returns the same `{ people, relationships, focus }` shape a fixture
 * already has, so the caller doesn't need to know the difference.
 */

/** Pure — validates and reshapes a raw /api/tree response body. Exported
 *  separately from the fetch so it's unit-testable without a network call. */
export function parseRealFamilyResponse(data) {
  if (!data || !Array.isArray(data.people) || !Array.isArray(data.relationships)) {
    throw new Error('This family tree has no data yet — nothing to load.');
  }
  if (!data.people.length) {
    throw new Error('This family tree is empty — nothing to load.');
  }
  const focus = data.myPersonId && data.people.some((p) => p.id === data.myPersonId)
    ? data.myPersonId
    : data.people[0].id;
  return { people: data.people, relationships: data.relationships, focus };
}

export async function fetchRealFamily() {
  let res;
  try {
    res = await fetch('/api/tree', { method: 'GET' });
  } catch {
    throw new Error('Could not reach the server — check your connection and try again.');
  }
  if (res.status === 401) {
    throw new Error('Not signed in — sign in to Bloodline in this browser tab first, then retry.');
  }
  if (!res.ok) {
    throw new Error(`Server error loading the tree (${res.status}).`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('The server response could not be read.');
  }
  return parseRealFamilyResponse(data);
}
