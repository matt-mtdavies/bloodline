/*
 * Family Moments slice 3 — resolves place strings ("Cardiff, Wales") to
 * town/city-centroid coordinates via OpenStreetMap's Nominatim, cached in
 * D1 (migrations/0015_place_geocode.sql). The cache is global, not scoped
 * to one family — a place name is public geography, not private family
 * data, so there's no reason for two different families with a relative in
 * Cardiff to each pay for (and rate-limit against) their own lookup.
 *
 * Only ever geocodes whatever's already stored in a person's residence
 * field (always a "City, Country"-shaped string in this app — see
 * EditPersonSheet's own placeholder), never a street address, and never
 * requests or stores anything more precise than that.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy requires an identifying User-Agent (and asks for
// a way to reach the operator) — https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = 'Bloodline/1.0 (+https://myfamilybloodline.com; family-tree app; town/city-level geocoding only, no street addresses)';
// Usage policy caps unauthenticated apps at 1 request/second.
const RATE_LIMIT_MS = 1100;

function normalizePlaceKey(place) {
  return String(place || '').trim().toLowerCase();
}

async function fetchFromNominatim(place) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(place)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const results = await res.json();
  if (!Array.isArray(results) || !results.length) return null;
  const r = results[0];
  const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, displayName: r.display_name || null };
}

async function getCached(env, key) {
  return env.DB.prepare('SELECT lat, lon, status FROM place_geocode WHERE place_key = ?').bind(key).first();
}

// A genuine "no results" answer from Nominatim IS cached as `not_found` —
// that's real signal, worth remembering so the same unresolvable place
// isn't re-queried on every request. A transient failure (network error,
// Nominatim briefly down or rate-limiting us) is deliberately NOT written
// here at all — see geocodePlaces' own try/catch — so it's simply retried
// on a later request rather than poisoning the cache forever.
async function putCached(env, key, result) {
  if (result) {
    await env.DB.prepare(
      `INSERT INTO place_geocode (place_key, display_name, lat, lon, status, resolved_at)
       VALUES (?, ?, ?, ?, 'ok', unixepoch())
       ON CONFLICT(place_key) DO UPDATE SET
         display_name = excluded.display_name, lat = excluded.lat, lon = excluded.lon,
         status = 'ok', resolved_at = excluded.resolved_at`,
    ).bind(key, result.displayName, result.lat, result.lon).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO place_geocode (place_key, display_name, lat, lon, status, resolved_at)
       VALUES (?, NULL, NULL, NULL, 'not_found', unixepoch())
       ON CONFLICT(place_key) DO UPDATE SET status = 'not_found', resolved_at = excluded.resolved_at`,
    ).bind(key).run();
  }
}

/*
 * Resolves a batch of place strings to {lat, lon} — cache-first, rate-
 * limited sequential Nominatim calls only for whatever isn't already
 * cached. Returns a plain object keyed by the ORIGINAL (not normalized)
 * place string the caller passed in, so lib/insightModules.js's
 * nearbyRelatives can look results up directly by person.residence. A
 * place that can't be resolved (bad data, a transient provider failure, or
 * a genuine "no such place") maps to null — the caller never needs to
 * distinguish why.
 */
export async function geocodePlaces(env, places) {
  const out = {};
  // normalized key -> every ORIGINAL string that normalized to it (plural —
  // a real bug here during development mapped only the first one, silently
  // leaving any differently-cased/whitespaced duplicate unresolved in the
  // output even though its key WAS successfully geocoded).
  const originalsByKey = new Map();
  for (const p of places) {
    const key = normalizePlaceKey(p);
    if (!key) continue;
    if (!originalsByKey.has(key)) originalsByKey.set(key, []);
    originalsByKey.get(key).push(p);
  }

  let lastFetchAt = 0;
  for (const [key, originals] of originalsByKey) {
    const cached = await getCached(env, key);
    let resolved;
    if (cached) {
      resolved = cached.status === 'ok' ? { lat: cached.lat, lon: cached.lon } : null;
    } else {
      const wait = RATE_LIMIT_MS - (Date.now() - lastFetchAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastFetchAt = Date.now();
      try {
        const fetched = await fetchFromNominatim(originals[0]);
        await putCached(env, key, fetched);
        resolved = fetched ? { lat: fetched.lat, lon: fetched.lon } : null;
      } catch {
        resolved = null; // transient — not cached, retried on a later request
      }
    }
    for (const original of originals) out[original] = resolved;
  }
  return out;
}
