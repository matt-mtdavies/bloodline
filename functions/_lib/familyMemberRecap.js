/*
 * Recap cutoff — per-(family, user) "seen up to" marker for the recap tour
 * (migration 0021, real user feedback: "the updates should only appear once
 * per user, not per device"). Same "thin route, real logic here" split, and
 * the same explicit-(familyId, userId)-parameter convention, as
 * functions/_lib/familyMemberPreference.js — this file never resolves
 * "which family" on its own either.
 *
 * Unlike the perimeter preference (an explicit setting a member chooses),
 * this value only ever needs to move FORWARD, and two devices can genuinely
 * race to sync it (e.g. two tabs open on two different phones). So there's
 * no separate get-then-compare-then-write dance here — the write itself is
 * a ratchet (`MAX(existing, incoming)` inside the SQL), which converges to
 * the same correct result regardless of write order, race, or which device
 * happens to sync last.
 */

export async function getFamilyMemberRecapCutoff(env, { familyId, userId }) {
  const row = await env.DB.prepare(
    'SELECT cutoff_at FROM family_member_recap WHERE family_id = ? AND user_id = ?',
  ).bind(familyId, userId).first();
  return { cutoffAt: row ? row.cutoff_at : null };
}

/*
 * Advances the stored cutoff to MAX(existing, cutoffAt) and returns the
 * final, post-ratchet value — which may be the value already stored, not
 * the one just sent, if this device's own local cutoff was behind another
 * device's. Callers should always adopt the RETURNED value locally, not
 * assume their own write won.
 */
export async function advanceFamilyMemberRecapCutoff(env, { familyId, userId, cutoffAt, now = Date.now() }) {
  if (!Number.isFinite(cutoffAt)) {
    throw new Error('cutoffAt must be a finite number');
  }
  const nowSec = Math.floor(now / 1000);
  await env.DB.prepare(
    `INSERT INTO family_member_recap (family_id, user_id, cutoff_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(family_id, user_id) DO UPDATE SET
       cutoff_at = MAX(family_member_recap.cutoff_at, excluded.cutoff_at),
       updated_at = excluded.updated_at`,
  ).bind(familyId, userId, cutoffAt, nowSec).run();
  return getFamilyMemberRecapCutoff(env, { familyId, userId });
}
