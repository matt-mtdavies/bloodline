/*
 * Family Moments slice 4 ("forgotten people") — records and reads back one
 * viewer's own "last viewed" timestamps for the profiles in their family.
 * Strictly private: every function here is scoped to the CALLER's own
 * viewer_user_id, resolved server-side from their session — there is no
 * function in this file, and there must never be one added, that reads
 * another user's rows. See migrations/0016_profile_view.sql's own header
 * for why that boundary matters here specifically.
 */
import { resolveCanonicalFamily } from './exportService.js';

// resolveCanonicalFamily lives in exportService.js (it needed it first) but
// is a generic "which family is this user in" lookup with nothing export-
// specific about it — reused here rather than writing a third copy of the
// same logic (functions/api/tree.js has its own independent inline version
// too). Worth eventually extracting into functions/_lib/family.js; not done
// here to keep this slice's diff to what it actually needs.

export async function recordProfileView(env, { viewerUserId, personId, now = Date.now() }) {
  const membership = await resolveCanonicalFamily(env, viewerUserId);
  if (!membership) return; // no family membership resolved — nothing to scope this view to
  await env.DB.prepare(
    `INSERT INTO profile_view (viewer_user_id, family_id, person_id, viewed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(viewer_user_id, family_id, person_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
  ).bind(viewerUserId, membership.family_id, personId, Math.floor(now / 1000)).run();
}

// Every profile the caller has EVER viewed in their own family, keyed by
// person_id, value the unix-seconds timestamp of their most recent view.
// Never takes a target user id — always the caller's own session.
export async function getLastViewedMap(env, { viewerUserId }) {
  const membership = await resolveCanonicalFamily(env, viewerUserId);
  if (!membership) return {};
  const { results } = await env.DB.prepare(
    'SELECT person_id, viewed_at FROM profile_view WHERE viewer_user_id = ? AND family_id = ?',
  ).bind(viewerUserId, membership.family_id).all();
  const out = {};
  for (const r of results || []) out[r.person_id] = r.viewed_at;
  return out;
}
