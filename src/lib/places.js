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
