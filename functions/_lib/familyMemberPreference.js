/*
 * Family Perimeter — per-(family, user) preference storage
 * (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md §9.1/§9.2, Phase 3).
 *
 * Deliberately its own small module, same "thin route, real logic here"
 * split as functions/_lib/profileViews.js. Every function here is scoped to
 * ONE (familyId, userId) pair passed in explicitly by the caller — this file
 * never resolves "which family" on its own, unlike profileViews.js, because
 * the route always already has that from resolveCanonicalFamily; keeping it
 * an explicit parameter here (rather than re-deriving it) makes the
 * "can only touch your OWN row" authorization boundary visible at every
 * call site instead of buried in this file.
 */
import { uid } from './util.js';

// first = Close family (1st cousins), second = Extended (2nd), third = Wider
// (3rd), everyone = Complete family tree — exactly §3.1/§9.1's vocabulary.
// Deliberately NOT the numeric 1/2/3 that src/lib/perspectiveIndex.js's
// `perimeterLevel` option takes — that engine was already shipped and
// tested (Phase 2) against its own numeric convention, so the string<->
// number mapping lives at this boundary rather than changing either side.
export const PERIMETER_LEVELS = ['first', 'second', 'third', 'everyone'];
export const DEFAULT_PERIMETER_LEVEL = 'everyone';

export function isValidPerimeterLevel(level) {
  return PERIMETER_LEVELS.includes(level);
}

/*
 * Returns the caller's saved preference for one family, or the safe default
 * if they've never chosen one.
 *
 * `hasSavedPreference: false` distinguishes "never set, defaulting" from
 * "a row exists" — but a row existing is NOT the same as the member having
 * made an explicit choice: `isRecommendation: true` (Codex review, PR #88)
 * marks a row the SYSTEM planted via the `ifUnset` starting-recommendation
 * flow, never confirmed by the member. Callers that need "should the
 * Recommended badge still show?" must check `isRecommendation`, not
 * `hasSavedPreference` — treating a planted recommendation as an explicit
 * choice was the exact bug this field fixes.
 */
export async function getFamilyMemberPreference(env, { familyId, userId }) {
  const row = await env.DB.prepare(
    'SELECT perimeter_level, source, preference_version, updated_at FROM family_member_preference WHERE family_id = ? AND user_id = ?',
  ).bind(familyId, userId).first();
  if (!row) {
    return {
      perimeterLevel: DEFAULT_PERIMETER_LEVEL, preferenceVersion: 0,
      hasSavedPreference: false, isRecommendation: false, updatedAt: null,
    };
  }
  return {
    perimeterLevel: row.perimeter_level,
    preferenceVersion: row.preference_version,
    hasSavedPreference: true,
    isRecommendation: row.source === 'recommended',
    updatedAt: row.updated_at,
  };
}

/*
 * Sets the caller's preference for one family. `ifUnset: true` uses
 * INSERT OR IGNORE instead of an upsert — a genuinely idempotent "plant a
 * starting recommendation only if nobody has chosen anything yet" write
 * (the §3.1 "new users offered Extended family" flow), safe to call any
 * number of times without ever clobbering a real choice, and without a
 * separate read-before-write that could race. The planted row is stamped
 * `source: 'recommended'` — never treated as an explicit choice until the
 * member actually saves something themselves.
 *
 * An ordinary (non-ifUnset) save always stamps `source: 'explicit'`,
 * unconditionally — even re-selecting the SAME level a recommendation
 * already held is a real, meaningful transition (confirming a suggestion
 * is not the same as never having chosen), so it still bumps the version
 * and writes an audit row. The one case that's skipped entirely as a true
 * no-op is re-saving a level that was ALREADY explicit — genuinely nothing
 * changed, so there is genuinely nothing to version-bump or audit.
 *
 * Every real change writes an audit row (§9.2) — old_level/new_level only,
 * never any relationship or tree content.
 */
export async function setFamilyMemberPreference(env, { familyId, userId, level, ifUnset = false, now = Date.now() }) {
  if (!isValidPerimeterLevel(level)) {
    throw new Error(`invalid perimeter level: ${level}`);
  }
  const nowSec = Math.floor(now / 1000);
  const before = await getFamilyMemberPreference(env, { familyId, userId });

  if (ifUnset) {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO family_member_preference (family_id, user_id, perimeter_level, source, preference_version, updated_at)
       VALUES (?, ?, ?, 'recommended', 1, ?)`,
    ).bind(familyId, userId, level, nowSec).run();
    const changesApplied = (result?.meta?.changes ?? 0) > 0;
    if (!changesApplied) {
      // A row already existed — ifUnset correctly left it alone. Return the
      // value that's ACTUALLY now in effect, not the level that was offered.
      return before;
    }
    await writeAudit(env, { familyId, userId, oldLevel: null, newLevel: level, now: nowSec });
    return { perimeterLevel: level, preferenceVersion: 1, hasSavedPreference: true, isRecommendation: true, updatedAt: nowSec };
  }

  // True no-op: already an explicit choice, and re-saving the identical
  // level — nothing changed, so nothing is written.
  if (before.hasSavedPreference && !before.isRecommendation && before.perimeterLevel === level) {
    return before;
  }

  const nextVersion = (before.preferenceVersion || 0) + 1;
  await env.DB.prepare(
    `INSERT INTO family_member_preference (family_id, user_id, perimeter_level, source, preference_version, updated_at)
     VALUES (?, ?, ?, 'explicit', ?, ?)
     ON CONFLICT(family_id, user_id) DO UPDATE SET
       perimeter_level = excluded.perimeter_level,
       source = 'explicit',
       preference_version = excluded.preference_version,
       updated_at = excluded.updated_at`,
  ).bind(familyId, userId, level, nextVersion, nowSec).run();

  await writeAudit(env, {
    familyId, userId,
    oldLevel: before.hasSavedPreference ? before.perimeterLevel : null,
    newLevel: level,
    now: nowSec,
  });

  return { perimeterLevel: level, preferenceVersion: nextVersion, hasSavedPreference: true, isRecommendation: false, updatedAt: nowSec };
}

async function writeAudit(env, { familyId, userId, oldLevel, newLevel, now }) {
  await env.DB.prepare(
    `INSERT INTO family_member_preference_audit (id, family_id, user_id, old_level, new_level, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(uid('pref_audit_'), familyId, userId, oldLevel, newLevel, now).run();
}
