import { json } from '../_lib/util.js';
import { recordProfileView, getLastViewedMap } from '../_lib/profileViews.js';

/*
 * POST /api/profile-views — record that the caller just viewed one profile
 * (body: { personId }). GET /api/profile-views — the caller's own full
 * "last viewed" map for their family, { [personId]: viewedAtUnixSeconds }.
 * Both are scoped to the caller's own session-derived user id — see
 * functions/_lib/profileViews.js's own header for why this must stay that
 * way. Route file is deliberately thin, matching every other feature here.
 */
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Malformed JSON body.' }, { status: 400 });
  }
  const personId = typeof body?.personId === 'string' ? body.personId.trim() : '';
  if (!personId) return json({ error: 'bad_request', message: 'personId is required.' }, { status: 400 });
  // Skipping a view of the caller's OWN tree profile (not a meaningful
  // "forgotten person" signal) has to happen client-side, before this
  // endpoint is even called — personId is a tree-internal id (store.js's
  // uid()) and data.user.uid is the D1 auth user id, two entirely
  // different id spaces; there's no cheap way to resolve "which person in
  // this tree is the caller themselves" from here without an extra lookup
  // the client already has for free (myPersonId).

  await recordProfileView(env, { viewerUserId: data.user.uid, personId });
  return json({ ok: true });
}

export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  const lastViewed = await getLastViewedMap(env, { viewerUserId: data.user.uid });
  return json({ lastViewed });
}
