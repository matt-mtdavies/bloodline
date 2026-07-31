/**
 * Unit tests for functions/_lib/familyMemberPreference.js — Family Perimeter
 * per-(family, user) preference storage (Phase 3). Same lightweight
 * in-memory D1 fake convention as tests/profileViews.test.mjs.
 * Run with: node tests/familyMemberPreference.test.mjs
 */
import assert from 'node:assert/strict';
import {
  getFamilyMemberPreference, setFamilyMemberPreference, isValidPerimeterLevel, PERIMETER_LEVELS,
} from '../functions/_lib/familyMemberPreference.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeEnv({ prefs = [] } = {}) {
  const prefRows = prefs.slice();
  const auditRows = [];

  function first(sql, args) {
    if (sql.includes('FROM family_member_preference WHERE')) {
      const [familyId, userId] = args;
      return prefRows.find((r) => r.family_id === familyId && r.user_id === userId) || null;
    }
    throw new Error(`fakeEnv: unhandled .first(): ${sql}`);
  }

  function run(sql, args) {
    if (sql.includes('INSERT OR IGNORE INTO family_member_preference')) {
      const [familyId, userId, level, version, updatedAt] = args;
      const existing = prefRows.find((r) => r.family_id === familyId && r.user_id === userId);
      if (existing) return { success: true, meta: { changes: 0 } };
      prefRows.push({ family_id: familyId, user_id: userId, perimeter_level: level, source: 'recommended', preference_version: version, updated_at: updatedAt });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO family_member_preference') && sql.includes('ON CONFLICT')) {
      const [familyId, userId, level, version, updatedAt] = args;
      const existing = prefRows.find((r) => r.family_id === familyId && r.user_id === userId);
      if (existing) {
        existing.perimeter_level = level;
        existing.source = 'explicit';
        existing.preference_version = version;
        existing.updated_at = updatedAt;
      } else {
        prefRows.push({ family_id: familyId, user_id: userId, perimeter_level: level, source: 'explicit', preference_version: version, updated_at: updatedAt });
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes('INSERT INTO family_member_preference_audit')) {
      const [id, familyId, userId, oldLevel, newLevel, changedAt] = args;
      auditRows.push({ id, family_id: familyId, user_id: userId, old_level: oldLevel, new_level: newLevel, changed_at: changedAt });
      return { success: true };
    }
    throw new Error(`fakeEnv: unhandled .run(): ${sql}`);
  }

  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() { return first(sql, args); },
      async run() { return run(sql, args); },
    };
  }

  return { env: { DB: { prepare: (sql) => stmt(sql) } }, prefRows, auditRows };
}

// ── validation ──────────────────────────────────────────────────────────

await atest('isValidPerimeterLevel accepts exactly first/second/third/everyone', () => {
  for (const l of PERIMETER_LEVELS) assert.ok(isValidPerimeterLevel(l));
  assert.ok(!isValidPerimeterLevel('fourth'));
  assert.ok(!isValidPerimeterLevel(1));
  assert.ok(!isValidPerimeterLevel(''));
  assert.ok(!isValidPerimeterLevel(null));
});

await atest('setFamilyMemberPreference rejects an invalid level and writes nothing', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv();
  await assert.rejects(() => setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'fourth' }));
  assert.equal(prefRows.length, 0);
  assert.equal(auditRows.length, 0);
});

// ── read defaults ───────────────────────────────────────────────────────

await atest('getFamilyMemberPreference defaults to everyone, hasSavedPreference:false, isRecommendation:false, when no row exists', async () => {
  const { env } = makeFakeEnv();
  const pref = await getFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1' });
  assert.deepEqual(pref, { perimeterLevel: 'everyone', preferenceVersion: 0, hasSavedPreference: false, isRecommendation: false, updatedAt: null });
});

await atest('getFamilyMemberPreference returns the real saved (explicit) row when one exists', async () => {
  const { env } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'first', source: 'explicit', preference_version: 3, updated_at: 1000 }] });
  const pref = await getFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1' });
  assert.deepEqual(pref, { perimeterLevel: 'first', preferenceVersion: 3, hasSavedPreference: true, isRecommendation: false, updatedAt: 1000 });
});

await atest('getFamilyMemberPreference reports isRecommendation:true for a row planted via ifUnset, never confirmed', async () => {
  const { env } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'second', source: 'recommended', preference_version: 1, updated_at: 1000 }] });
  const pref = await getFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1' });
  assert.equal(pref.hasSavedPreference, true);
  assert.equal(pref.isRecommendation, true);
});

// ── ordinary save (settings UI) ─────────────────────────────────────────

await atest('setFamilyMemberPreference (ordinary) creates a row as explicit, bumps version, and audits old:null -> new', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv();
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', now: 5_000_000 });
  assert.equal(saved.perimeterLevel, 'second');
  assert.equal(saved.preferenceVersion, 1);
  assert.equal(saved.isRecommendation, false);
  assert.equal(prefRows.length, 1);
  assert.equal(prefRows[0].source, 'explicit');
  assert.equal(auditRows.length, 1);
  assert.deepEqual({ old: auditRows[0].old_level, new: auditRows[0].new_level }, { old: null, new: 'second' });
});

await atest('setFamilyMemberPreference (ordinary) overwrites an existing row, bumps version, audits old -> new', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'everyone', source: 'explicit', preference_version: 1, updated_at: 1 }] });
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'third', now: 5_000_000 });
  assert.equal(saved.perimeterLevel, 'third');
  assert.equal(saved.preferenceVersion, 2, 'version must bump, not reset');
  assert.equal(prefRows.length, 1, 'must update in place, never a second row');
  assert.deepEqual({ old: auditRows[0].old_level, new: auditRows[0].new_level }, { old: 'everyone', new: 'third' });
});

await atest('one user changing their own preference never touches a different user\'s row for the same family', async () => {
  const { env, prefRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u2', perimeter_level: 'first', source: 'explicit', preference_version: 1, updated_at: 1 }] });
  await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'third', now: 5_000_000 });
  const other = prefRows.find((r) => r.user_id === 'u2');
  assert.equal(other.perimeter_level, 'first', 'a different user\'s row must be untouched');
  assert.equal(prefRows.length, 2);
});

// ── real no-op (Codex review, PR #88, minor) ────────────────────────────

await atest('re-saving the SAME level that is already explicit is a true no-op — no version bump, no audit row', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'first', source: 'explicit', preference_version: 4, updated_at: 1 }] });
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'first', now: 5_000_000 });
  assert.equal(saved.preferenceVersion, 4, 'genuinely nothing changed — version must not bump');
  assert.equal(prefRows[0].updated_at, 1, 'row must be untouched, not re-written with the same values');
  assert.equal(auditRows.length, 0, 'a true no-op must not create a misleading audit entry');
});

await atest('re-saving the SAME level that was only a RECOMMENDATION is a real change (confirms it) — bumps version, audits, and becomes explicit', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'second', source: 'recommended', preference_version: 1, updated_at: 1 }] });
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', now: 5_000_000 });
  assert.equal(saved.preferenceVersion, 2, 'confirming a recommendation is a real transition, even though the level string is unchanged');
  assert.equal(saved.isRecommendation, false);
  assert.equal(prefRows[0].source, 'explicit');
  assert.equal(auditRows.length, 1);
});

// ── new-user recommendation (ifUnset) — Codex review test scenarios ────

await atest('new claim: ifUnset plants Extended (second) as a recommendation — isRecommendation:true, audited', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv();
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', ifUnset: true, now: 5_000_000 });
  assert.equal(saved.perimeterLevel, 'second');
  assert.equal(saved.isRecommendation, true, 'a planted recommendation must be distinguishable from an explicit choice');
  assert.equal(prefRows.length, 1);
  assert.equal(prefRows[0].source, 'recommended');
  assert.equal(auditRows.length, 1, 'planting a genuinely new recommendation is still an auditable change');
});

await atest('explicit save after a planted recommendation: the badge state (isRecommendation) is cleared', async () => {
  const { env } = makeFakeEnv();
  await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', ifUnset: true, now: 1_000_000 });
  const afterPlant = await getFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1' });
  assert.equal(afterPlant.isRecommendation, true);

  const afterExplicitSave = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', now: 2_000_000 });
  assert.equal(afterExplicitSave.isRecommendation, false, 'an explicit save must clear the recommendation flag, even choosing the same level');
});

await atest('existing user (no row, never planted): reads as everyone, hasSavedPreference:false, isRecommendation:false — no recommendation shown', async () => {
  const { env } = makeFakeEnv(); // no prefs at all — simulates a long-standing user who claimed before this feature existed
  const pref = await getFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1' });
  assert.equal(pref.perimeterLevel, 'everyone');
  assert.equal(pref.hasSavedPreference, false);
  assert.equal(pref.isRecommendation, false, 'an existing user who never triggered the claim-time plant must not see a recommendation badge');
});

await atest('setFamilyMemberPreference with ifUnset:true is a true no-op when a real explicit choice already exists — never overwrites, never audits', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'first', source: 'explicit', preference_version: 1, updated_at: 1 }] });
  const saved = await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', ifUnset: true, now: 5_000_000 });
  assert.equal(saved.perimeterLevel, 'first', 'the real, existing choice must win — the recommendation must never overwrite it');
  assert.equal(prefRows.length, 1);
  assert.equal(prefRows[0].perimeter_level, 'first');
  assert.equal(auditRows.length, 0, 'a no-op ifUnset write must not create a misleading audit entry');
});

await atest('setFamilyMemberPreference with ifUnset:true called twice in a row is idempotent (second call is a no-op)', async () => {
  const { env, prefRows, auditRows } = makeFakeEnv();
  await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', ifUnset: true, now: 1_000_000 });
  await setFamilyMemberPreference(env, { familyId: 'fam_1', userId: 'u1', level: 'second', ifUnset: true, now: 2_000_000 });
  assert.equal(prefRows.length, 1);
  assert.equal(auditRows.length, 1, 'only the FIRST plant is a real change worth auditing');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
