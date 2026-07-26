import { json } from '../_lib/util.js';
import { geocodePlaces } from '../_lib/geocode.js';

/*
 * POST /api/geocode — resolves a batch of place strings (person.residence
 * values) to town/city-centroid coordinates, for Family Moments' nearby-
 * relatives insight (docs/FAMILY-MOMENTS.md). Requires login (not a public
 * proxy for arbitrary geocoding), but the D1 cache in functions/_lib/
 * geocode.js is global across every family — a place name is public
 * geography, not this family's private data.
 */
const MAX_PLACES_PER_REQUEST = 50; // generous — a single family's distinct residence strings rarely approach this

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Malformed JSON body.' }, { status: 400 });
  }
  const places = Array.isArray(body?.places) ? body.places.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (!places.length) return json({ places: {} });
  if (places.length > MAX_PLACES_PER_REQUEST) {
    return json({ error: 'bad_request', message: `Too many places in one request (max ${MAX_PLACES_PER_REQUEST}).` }, { status: 400 });
  }

  try {
    const resolved = await geocodePlaces(env, places);
    return json({ places: resolved });
  } catch (err) {
    // geocodePlaces already degrades gracefully around the one known
    // schema-lag case (migration 0018's columns not yet applied to this
    // database — see _lib/geocode.js's own try/catch). Anything else
    // reaching here is a genuine, unexpected failure (a real D1 outage,
    // say) — fail clean with a 503 rather than an unhandled exception, so
    // a client-side caller (geocodePlace/geocodePlaces in lib/places.js)
    // sees an ordinary "not ok" response instead of a raw platform error.
    console.error('POST /api/geocode failed', err);
    return json({ error: 'geocode_failed' }, { status: 503 });
  }
}
