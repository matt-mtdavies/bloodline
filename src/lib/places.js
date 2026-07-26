/*
 * Client-side geocoding for a single Places Lived entry — thin wrapper
 * around the existing /api/geocode endpoint (functions/api/geocode.js,
 * functions/_lib/geocode.js's Nominatim + D1 cache), same convention as
 * summarizeDocument()/searchTrove() (best-effort, never throws, null on
 * any failure). Reuses the exact endpoint App.jsx already calls in bulk
 * for the nearby-relatives/heartlands insights — this is the same thing,
 * just for one place at a time, on demand, right when someone adds or
 * edits a residence.
 *
 * Requires a logged-in session (the endpoint itself is user-gated) — in
 * demo mode, or if geocoding fails for any reason, a residence still saves
 * fine with lat/lon left null; the Places Lived chain/cards render from
 * `place`/`from_year`/`to_year` alone and don't need coordinates at all
 * (see PlacesLived.jsx) — geocoding only adds potential future distance-
 * insight value, it's never required for the feature to work.
 */
export async function geocodePlace(place, { timeoutMs = 8000 } = {}) {
  if (!place?.trim()) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ places: [place] }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const { places } = await res.json();
    return places?.[place] || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Batch counterpart, used by store.js's backfillResidenceGeocodes to
// retroactively resolve any residence saved before geocoding ran (or while
// it failed) — e.g. a deploy-timing gap, a rate-limited moment, or entries
// made before this feature had geocoding wired in at all. Chunks into
// groups of MAX_PLACES_PER_REQUEST (mirroring functions/api/geocode.js's
// own cap) and sends them SEQUENTIALLY, not in parallel — the server's own
// rate limiter (functions/_lib/geocode.js) is scoped to a single request,
// not shared across concurrent ones, so firing chunks in parallel would
// multiply the true request rate against Nominatim's usage policy. Returns
// a flat { [place]: {lat, lon, suburb, state, country} | null } map across
// every chunk; a failed chunk simply leaves its places absent from the
// result rather than aborting the whole batch.
const MAX_PLACES_PER_REQUEST = 50;
export async function geocodePlaces(places, { timeoutMs = 8000 } = {}) {
  const distinct = [...new Set((places || []).map((p) => p?.trim()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < distinct.length; i += MAX_PLACES_PER_REQUEST) {
    const chunk = distinct.slice(i, i + MAX_PLACES_PER_REQUEST);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ places: chunk }),
        signal: ac.signal,
      });
      if (res.ok) {
        const { places: resolved } = await res.json();
        Object.assign(out, resolved);
      }
    } catch {
      /* this chunk failed — the rest still get attempted */
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}
