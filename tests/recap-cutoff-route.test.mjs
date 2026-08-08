/**
 * Unit tests for functions/api/user/recap-cutoff.js — the thin route file
 * over functions/_lib/familyMemberRecap.js (the actual logic, covered by
 * tests/familyMemberRecap.test.mjs). Only the auth/validation/membership-
 * resolution glue is tested here, same convention as
 * tests/perimeter-route.test.mjs.
 * Run with: node tests/recap-cutoff-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPatch } from '../functions/api/user/recap-cutoff.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

function makeFakeEnv({ familyId = 'fam_1', role = 'owner', rows = [] } = {}) {
  const recapRows = rows.slice();
  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() {
        if (sql.includes('SELECT family_id FROM user WHERE id')) return { family_id: familyId };
        if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
          return { family_id: familyId, role, family_name: 'Test Family' };
        }
        if (sql.includes('FROM family_member_recap WHERE')) {
          const [fid, uid] = args;
          return recapRows.find((r) => r.family_id === fid && r.user_id === uid) || null;
        }
        throw new Error(`unhandled .first(): ${sql}`);
      },
      async run() {
        if (sql.includes('INSERT INTO family_member_recap') && sql.includes('ON CONFLICT')) {
          const [fid, uid, cutoffAt, updatedAt] = args;
          const existing = recapRows.find((r) => r.family_id === fid && r.user_id === uid);
          if (existing) { existing.cutoff_at = Math.max(existing.cutoff_at, cutoffAt); existing.updated_at = updatedAt; }
          else recapRows.push({ family_id: fid, user_id: uid, cutoff_at: cutoffAt, updated_at: updatedAt });
          return { success: true };
        }
        throw new Error(`unhandled .run(): ${sql}`);
      },
    };
  }
  return { env: { DB: { prepare: (sql) => stmt(sql) } }, recapRows };
}

function makeMissingRecapTableEnv({ familyId = 'fam_1', role = 'owner' } = {}) {
  function stmt(sql) {
    return {
      bind() { return this; },
      async first() {
        if (sql.includes('SELECT family_id FROM user WHERE id')) return { family_id: familyId };
        if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
          return { family_id: familyId, role, family_name: 'Test Family' };
        }
        if (sql.includes('FROM family_member_recap')) throw new Error('no such table: family_member_recap');
        throw new Error(`unhandled .first(): ${sql}`);
      },
      async run() {
        if (sql.includes('family_member_recap')) throw new Error('no such table: family_member_recap');
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

await atest('GET: cutoffAt:null when the caller has no resolvable family', async () => {
  const res = await onRequestGet({ env: makeUnclaimedEnv(), data: { user: { uid: 'ghost' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cutoffAt, null);
});

await atest('GET: returns the caller\'s own saved cutoff', async () => {
  const { env } = makeFakeEnv({ rows: [{ family_id: 'fam_1', user_id: 'u1', cutoff_at: 5000, updated_at: 1 }] });
  const res = await onRequestGet({ env, data: { user: { uid: 'u1' } } });
  const body = await res.json();
  assert.equal(body.cutoffAt, 5000);
});

await atest('PATCH: 401 when not logged in', async () => {
  const res = await onRequestPatch({ request: req({ cutoffAt: 5000 }), env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('PATCH: 400 on malformed JSON', async () => {
  const res = await onRequestPatch({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: {} }, data: { user: { uid: 'u1' } },
  });
  assert.equal(res.status, 400);
});

await atest('PATCH: 400 on a non-numeric cutoffAt', async () => {
  const { env } = makeFakeEnv();
  const res = await onRequestPatch({ request: req({ cutoffAt: 'not-a-number' }), env, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 400);
});

await atest('PATCH: 409 when the caller has no resolvable family', async () => {
  const res = await onRequestPatch({ request: req({ cutoffAt: 5000 }), env: makeUnclaimedEnv(), data: { user: { uid: 'ghost' } } });
  assert.equal(res.status, 409);
});

await atest('PATCH: saves the caller\'s own cutoff and returns the canonical value', async () => {
  const { env, recapRows } = makeFakeEnv();
  const res = await onRequestPatch({ request: req({ cutoffAt: 5000 }), env, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cutoffAt, 5000);
  assert.equal(recapRows.length, 1);
  assert.equal(recapRows[0].user_id, 'u1');
});

await atest('PATCH: end to end, ratchets forward and never backward across two calls', async () => {
  const { env } = makeFakeEnv();
  await onRequestPatch({ request: req({ cutoffAt: 9000 }), env, data: { user: { uid: 'u1' } } });
  const res = await onRequestPatch({ request: req({ cutoffAt: 1000 }), env, data: { user: { uid: 'u1' } } });
  const body = await res.json();
  assert.equal(body.cutoffAt, 9000, 'a smaller later write must not move the account-wide cutoff backwards');
});

// ── missing-migration safety (same convention as perimeter-route.test.mjs) ─

await atest('GET: 503 (not 500/unstructured) when family_member_recap doesn\'t exist yet', async () => {
  const res = await onRequestGet({ env: makeMissingRecapTableEnv(), data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'not_configured');
});

await atest('PATCH: 503 (not 500/unstructured) when family_member_recap doesn\'t exist yet', async () => {
  const res = await onRequestPatch({ request: req({ cutoffAt: 5000 }), env: makeMissingRecapTableEnv(), data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'not_configured');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
