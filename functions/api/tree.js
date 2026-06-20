import { json } from '../_lib/util.js';

/*
 * GET /api/tree — the shared family graph as { people, relationships }.
 *
 * This is the same shape the client's seed module produces, so the
 * visualization can read from either source. Phase 1's seeded demo runs off the
 * bundled seed; once D1 is provisioned and seeded this endpoint serves the live
 * graph with no client changes.
 */
export async function onRequestGet({ env }) {
  if (!env.DB) {
    return json({ error: 'Database not configured. Run the D1 migrations + seed.' }, { status: 503 });
  }

  const [{ results: people }, { results: relationships }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, display_name, given_names, family_name, maiden_name,
              birth_date, death_date, is_living, is_deceased, is_minor,
              gender, birth_place, bio, photo_key, confidence
         FROM person`,
    ).all(),
    env.DB.prepare(
      `SELECT id, from_person, to_person, type, qualifier, partner_status
         FROM relationship`,
    ).all(),
  ]);

  // Normalise SQLite integers to booleans for the client.
  for (const p of people) {
    p.is_living = !!p.is_living;
    p.is_deceased = !!p.is_deceased;
    p.is_minor = !!p.is_minor;
    // Absolute URLs and same-origin paths (e.g. /faces/…) pass through;
    // bare keys resolve to an R2-backed photo route.
    p.photo = p.photo_key
      ? /^(https?:|\/)/.test(p.photo_key)
        ? p.photo_key
        : `/api/photo/${p.photo_key}`
      : null;
  }

  return json(
    { people, relationships },
    { headers: { 'cache-control': 'private, max-age=15' } },
  );
}
