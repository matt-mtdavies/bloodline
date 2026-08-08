import { json } from '../../_lib/util.js';
import { resolveCanonicalFamily } from '../../_lib/exportService.js';
import { getFamilyMemberRecapCutoff, advanceFamilyMemberRecapCutoff } from '../../_lib/familyMemberRecap.js';

// A missing family_member_recap table (migration 0021 not yet applied to
// this environment) must fail CLEANLY, not as an unstructured 500 the
// client can't distinguish from a real bug — same convention as
// functions/api/user/perimeter.js.
async function safely(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error('[recap-cutoff] family_member_recap unavailable:', e.message);
    return { ok: false };
  }
}

/*
 * GET /api/user/recap-cutoff — the caller's own "seen the recap up to"
 * marker for their canonical family, so the "N updates since last visit"
 * tour is tracked once per ACCOUNT, not once per device (real feedback).
 * Always scoped to the caller's own session-derived user id, same as
 * api/user/perimeter.js — there is no "view someone else's cutoff" case.
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  const membershipResult = await safely(() => resolveCanonicalFamily(env, data.user.uid));
  if (!membershipResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  const membership = membershipResult.value;
  if (!membership) return json({ cutoffAt: null });

  const cutoffResult = await safely(() => getFamilyMemberRecapCutoff(env, { familyId: membership.family_id, userId: data.user.uid }));
  if (!cutoffResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  return json(cutoffResult.value);
}

/*
 * PATCH /api/user/recap-cutoff  { cutoffAt }
 *
 * Ratchets the stored cutoff forward — see
 * advanceFamilyMemberRecapCutoff's own doc comment for why this is safe to
 * call unconditionally from any device any time the local cutoff advances
 * (watching the recap, dismissing the nudge) or on login (reconciling this
 * device's local value against whatever another device already synced).
 */
export async function onRequestPatch({ request, env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Malformed JSON body.' }, { status: 400 });
  }

  const cutoffAt = Number(body?.cutoffAt);
  if (!Number.isFinite(cutoffAt)) {
    return json({ error: 'bad_request', message: 'cutoffAt must be a number (ms epoch).' }, { status: 400 });
  }

  const membershipResult = await safely(() => resolveCanonicalFamily(env, data.user.uid));
  if (!membershipResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  const membership = membershipResult.value;
  if (!membership) {
    return json({ error: 'no_family', message: 'Link your profile to your person in the tree first.' }, { status: 409 });
  }

  const savedResult = await safely(() => advanceFamilyMemberRecapCutoff(env, {
    familyId: membership.family_id, userId: data.user.uid, cutoffAt,
  }));
  if (!savedResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  return json(savedResult.value);
}
