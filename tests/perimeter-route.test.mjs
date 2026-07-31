/**
 * Unit tests for functions/api/user/perimeter.js — the thin route file over
 * functions/_lib/familyMemberPreference.js (the actual logic, covered by
 * tests/familyMemberPreference.test.mjs). Only the auth/validation/
 * membership-resolution glue is tested here, same convention as
 * tests/profile-views-route.test.mjs.
 * Run with: node tests/perimeter-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/user/perimeter.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

// A minimal fake DB just deep enough for resolveCanonicalFamily +
// getFamilyMemberPreference/setFamilyMemberPreference to run against.
function makeFakeEnv({ familyId = 'fam_1', role = 'owner', prefs = [] } = {}) {
  const prefRows = prefs.slice();
  const auditRows = [];
  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() {
        if (sql.includes('SELECT family_id FROM user WHERE id')) return { family_id: familyId };
        if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
          return { family_id: familyId, role, family_name: 'Test Family' };
        }
        if (sql.includes('FROM family_member_preference WHERE')) {
          const [fid, uid] = args;
          return prefRows.find((r) => r.family_id === fid && r.user_id === uid) || null;
        }
        throw new Error(`unhandled .first(): ${sql}`);
      },
      async run() {
        if (sql.includes('INSERT OR IGNORE INTO family_member_preference')) {
          const [fid, uid, level, version, updatedAt] = args;
          const existing = prefRows.find((r) => r.family_id === fid && r.user_id === uid);
          if (existing) return { success: true, meta: { changes: 0 } };
          prefRows.push({ family_id: fid, user_id: uid, perimeter_level: level, source: 'recommended', preference_version: version, updated_at: updatedAt });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO family_member_preference') && sql.includes('ON CONFLICT')) {
          const [fid, uid, level, version, updatedAt] = args;
          const existing = prefRows.find((r) => r.family_id === fid && r.user_id === uid);
          if (existing) { existing.perimeter_level = level; existing.source = 'explicit'; existing.preference_version = version; existing.updated_at = updatedAt; }
          else prefRows.push({ family_id: fid, user_id: uid, perimeter_level: level, source: 'explicit', preference_version: version, updated_at: updatedAt });
          return { success: true };
        }
        if (sql.includes('INSERT INTO family_member_preference_audit')) {
          auditRows.push(args);
          return { success: true };
        }
        throw new Error(`unhandled .run(): ${sql}`);
      },
    };
  }
  return { env: { DB: { prepare: (sql) => stmt(sql) } }, prefRows, auditRows };
}

// Simulates migration 0019 not yet applied: user/family_member resolve
// fine (a real, established user/family), but ANY touch of
// family_member_preference throws, exactly like a real "no such table"
// D1 error would.
function makeMissingPreferenceTableEnv({ familyId = 'fam_1', role = 'owner' } = {}) {
  function stmt(sql) {
    return {
      bind() { return this; },
      async first() {
        if (sql.includes('SELECT family_id FROM user WHERE id')) return { family_id: familyId };
        if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
          return { family_id: familyId, role, family_name: 'Test Family' };
        }
        if (sql.includes('FROM family_member_preference')) throw new Error('no such table: family_member_preference');
        throw new Error(`unhandled .first(): ${sql}`);
      },
      async run() {
        if (sql.includes('family_member_preference')) throw new Error('no such table: family_member_preference');
        throw new Error(`unhandled .run(): ${sql}`);
      },
    };
  }
  return { DB: { prepare: (sql) => stmt(sql) } };
}

function makeUnclaimedEnv() {
  function stmt(sql) {
    return {
      bind() { return this; },
      async first() {
        if (sql.includes('SELECT family_id FROM user WHERE id')) return null;
        if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) return null;
        throw new Error(`unhandled .first(): ${sql}`);
      },
    };
  }
  return { DB: { prepare: (sql) => stmt(sql) } };
}

await atest('GET: 401 when not logged in', async () => {
  const res = await onRequestGet({ env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('GET: 503 when DB is not configured', async () => {
  const res = await onRequestGet({ env: {}, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
});

await atest('GET: defaults to everyone/unclaimed when the caller has no resolvable family', async () => {
  const res = await onRequestGet({ env: makeUnclaimedEnv(), data: { user: { uid: 'ghost' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.perimeterLevel, 'everyone');
  assert.equal(body.unclaimed, true);
});

await atest('GET: returns the caller\'s own saved preference', async () => {
  const { env } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'first', preference_version: 2, updated_at: 1000 }] });
  const res = await onRequestGet({ env, data: { user: { uid: 'u1' } } });
  const body = await res.json();
  assert.equal(body.perimeterLevel, 'first');
  assert.equal(body.hasSavedPreference, true);
});

await atest('PATCH: 401 when not logged in', async () => {
  const res = await onRequestPatch({ request: req({ level: 'first' }), env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('PATCH: 400 on malformed JSON', async () => {
  const res = await onRequestPatch({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: {} }, data: { user: { uid: 'u1' } },
  });
  assert.equal(res.status, 400);
});

await atest('PATCH: 400 on an invalid level value', async () => {
  const { env } = makeFakeEnv();
  const res = await onRequestPatch({ request: req({ level: 'fourth' }), env, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 400);
});

await atest('PATCH: 409 when the caller has no resolvable family (nothing to set a perimeter on)', async () => {
  const res = await onRequestPatch({ request: req({ level: 'first' }), env: makeUnclaimedEnv(), data: { user: { uid: 'ghost' } } });
  assert.equal(res.status, 409);
});

await atest('PATCH: saves the caller\'s own preference and returns the canonical saved value', async () => {
  const { env, prefRows } = makeFakeEnv();
  const res = await onRequestPatch({ request: req({ level: 'third' }), env, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.perimeterLevel, 'third');
  assert.equal(prefRows.length, 1);
  assert.equal(prefRows[0].user_id, 'u1');
});

await atest('PATCH: ifUnset never overwrites an existing real choice, end to end through the route', async () => {
  const { env, prefRows } = makeFakeEnv({ prefs: [{ family_id: 'fam_1', user_id: 'u1', perimeter_level: 'first', source: 'explicit', preference_version: 1, updated_at: 1 }] });
  const res = await onRequestPatch({ request: req({ level: 'second', ifUnset: true }), env, data: { user: { uid: 'u1' } } });
  const body = await res.json();
  assert.equal(body.perimeterLevel, 'first');
  assert.equal(prefRows[0].perimeter_level, 'first');
});

await atest('PATCH: end to end, a planted recommendation reports isRecommendation:true, and an explicit save clears it', async () => {
  const { env } = makeFakeEnv();
  const plantRes = await onRequestPatch({ request: req({ level: 'second', ifUnset: true }), env, data: { user: { uid: 'u1' } } });
  const planted = await plantRes.json();
  assert.equal(planted.isRecommendation, true);

  const explicitRes = await onRequestPatch({ request: req({ level: 'second' }), env, data: { user: { uid: 'u1' } } });
  const confirmed = await explicitRes.json();
  assert.equal(confirmed.isRecommendation, false, 'an explicit save must clear the recommendation flag, even for the same level');

  const getRes = await onRequestGet({ env, data: { user: { uid: 'u1' } } });
  const read = await getRes.json();
  assert.equal(read.isRecommendation, false, 'the cleared state must persist and be read back correctly');
});

// ── missing-migration safety (Codex review, PR #88, P1 #2) ────────────────

await atest('GET: 503 (not 500/unstructured) when family_member_preference doesn\'t exist yet', async () => {
  const res = await onRequestGet({ env: makeMissingPreferenceTableEnv(), data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'not_configured');
});

await atest('PATCH: 503 (not 500/unstructured) when family_member_preference doesn\'t exist yet', async () => {
  const res = await onRequestPatch({ request: req({ level: 'first' }), env: makeMissingPreferenceTableEnv(), data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'not_configured');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
