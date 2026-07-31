import { json } from '../../_lib/util.js';
import { resolveCanonicalFamily } from '../../_lib/exportService.js';
import { getFamilyMemberPreference, setFamilyMemberPreference, isValidPerimeterLevel } from '../../_lib/familyMemberPreference.js';

// A missing family_member_preference table (migration 0019 not yet applied
// to this environment) must fail CLEANLY, not as an unstructured 500 the
// client can't distinguish from a real bug (Codex review, PR #88 — the
// spec's own "failure falls back safely and visibly" exit criterion). Every
// DB call below this point is wrapped through this helper.
async function safely(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    console.error('[perimeter] family_member_preference unavailable:', e.message);
    return { ok: false };
  }
}

/*
 * GET /api/user/perimeter — the caller's own Family Perimeter setting for
 * their canonical family (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
 * §9.2). Mirrors functions/api/profile-views.js's shape: always scoped to
 * the caller's own session-derived user id, never a target user — there is
 * no "view someone else's perimeter setting" case, ever (§4.1: "Personal:
 * your setting affects only your view").
 */
export async function onRequestGet({ env, data }) {
  if (!data.user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.DB) return json({ error: 'not_configured' }, { status: 503 });

  const membershipResult = await safely(() => resolveCanonicalFamily(env, data.user.uid));
  if (!membershipResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  const membership = membershipResult.value;
  if (!membership) return json({ perimeterLevel: 'everyone', hasSavedPreference: false, isRecommendation: false, unclaimed: true });

  const prefResult = await safely(() => getFamilyMemberPreference(env, { familyId: membership.family_id, userId: data.user.uid }));
  if (!prefResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  return json(prefResult.value);
}

/*
 * PATCH /api/user/perimeter  { level, ifUnset? }
 *
 * `ifUnset: true` is the one-time "plant a starting recommendation" write
 * used right after a member claims their own person for the first time
 * (§3.1: "new users should be offered Extended family as the recommended
 * starting point") — see setFamilyMemberPreference's own doc comment for
 * why this is safe to call unconditionally. Anything else is a normal,
 * unconditional overwrite from the Family Perimeter settings UI.
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

  const level = typeof body?.level === 'string' ? body.level : '';
  if (!isValidPerimeterLevel(level)) {
    return json({ error: 'bad_request', message: 'level must be one of first, second, third, everyone.' }, { status: 400 });
  }
  const ifUnset = body?.ifUnset === true;

  const membershipResult = await safely(() => resolveCanonicalFamily(env, data.user.uid));
  if (!membershipResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  const membership = membershipResult.value;
  if (!membership) {
    // §3.1: nobody without a claimed person yet has a family perimeter to
    // set — there's no tree to compute one FROM. Not an error the settings
    // UI needs to surface loudly; just nothing changed.
    return json({ error: 'no_family', message: 'Link your profile to your person in the tree to set a Family Perimeter.' }, { status: 409 });
  }

  const savedResult = await safely(() => setFamilyMemberPreference(env, {
    familyId: membership.family_id, userId: data.user.uid, level, ifUnset,
  }));
  if (!savedResult.ok) return json({ error: 'not_configured' }, { status: 503 });
  return json(savedResult.value);
}
