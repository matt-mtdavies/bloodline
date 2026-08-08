/**
 * Unit tests for functions/_lib/familyMemberRecap.js — per-(family, user)
 * recap-cutoff storage (migration 0021, real user feedback: "the updates
 * should only appear once per user, not per device"). Same lightweight
 * in-memory D1 fake convention as tests/familyMemberPreference.test.mjs.
 * Run with: node tests/familyMemberRecap.test.mjs
 */
import assert from 'node:assert/strict';
import { getFamilyMemberRecapCutoff, advanceFamilyMemberRecapCutoff } from '../functions/_lib/familyMemberRecap.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeEnv({ rows = [] } = {}) {
  const recapRows = rows.slice();

  function first(sql, args) {
    if (sql.includes('FROM family_member_recap WHERE')) {
      const [familyId, userId] = args;
      return recapRows.find((r) => r.family_id === familyId && r.user_id === userId) || null;
    }
    throw new Error(`fakeEnv: unhandled .first(): ${sql}`);
  }

  function run(sql, args) {
    if (sql.includes('INSERT INTO family_member_recap') && sql.includes('ON CONFLICT')) {
      const [familyId, userId, cutoffAt, updatedAt] = args;
      const existing = recapRows.find((r) => r.family_id === familyId && r.user_id === userId);
      if (existing) {
        existing.cutoff_at = Math.max(existing.cutoff_at, cutoffAt);
        existing.updated_at = updatedAt;
      } else {
        recapRows.push({ family_id: familyId, user_id: userId, cutoff_at: cutoffAt, updated_at: updatedAt });
      }
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

  return { env: { DB: { prepare: (sql) => stmt(sql) } }, recapRows };
}

await atest('getFamilyMemberRecapCutoff returns null when no row exists', async () => {
  const { env } = makeFakeEnv();
  const result = await getFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1' });
  assert.deepEqual(result, { cutoffAt: null });
});

await atest('getFamilyMemberRecapCutoff returns the stored value when a row exists', async () => {
  const { env } = makeFakeEnv({ rows: [{ family_id: 'fam_1', user_id: 'u1', cutoff_at: 5000, updated_at: 1 }] });
  const result = await getFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1' });
  assert.deepEqual(result, { cutoffAt: 5000 });
});

await atest('advanceFamilyMemberRecapCutoff rejects a non-finite cutoffAt and writes nothing', async () => {
  const { env, recapRows } = makeFakeEnv();
  await assert.rejects(() => advanceFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1', cutoffAt: NaN }));
  assert.equal(recapRows.length, 0);
});

await atest('advanceFamilyMemberRecapCutoff creates a row when none exists', async () => {
  const { env, recapRows } = makeFakeEnv();
  const result = await advanceFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1', cutoffAt: 5000, now: 5_000_000 });
  assert.deepEqual(result, { cutoffAt: 5000 });
  assert.equal(recapRows.length, 1);
});

await atest('advanceFamilyMemberRecapCutoff ratchets FORWARD — a larger incoming value overwrites', async () => {
  const { env, recapRows } = makeFakeEnv({ rows: [{ family_id: 'fam_1', user_id: 'u1', cutoff_at: 1000, updated_at: 1 }] });
  const result = await advanceFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1', cutoffAt: 2000, now: 5_000_000 });
  assert.deepEqual(result, { cutoffAt: 2000 });
  assert.equal(recapRows[0].cutoff_at, 2000);
});

await atest('advanceFamilyMemberRecapCutoff never moves BACKWARDS — a smaller incoming value is ignored, the larger existing value wins', async () => {
  const { env, recapRows } = makeFakeEnv({ rows: [{ family_id: 'fam_1', user_id: 'u1', cutoff_at: 9000, updated_at: 1 }] });
  const result = await advanceFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1', cutoffAt: 1000, now: 5_000_000 });
  assert.deepEqual(result, { cutoffAt: 9000 }, 'the stored value must win — this is the exact "two devices race, whichever is further ahead wins" guarantee the whole feature relies on');
  assert.equal(recapRows[0].cutoff_at, 9000);
});

await atest('one user advancing their own cutoff never touches a different user\'s row for the same family', async () => {
  const { env, recapRows } = makeFakeEnv({ rows: [{ family_id: 'fam_1', user_id: 'u2', cutoff_at: 1000, updated_at: 1 }] });
  await advanceFamilyMemberRecapCutoff(env, { familyId: 'fam_1', userId: 'u1', cutoffAt: 5000, now: 5_000_000 });
  const other = recapRows.find((r) => r.user_id === 'u2');
  assert.equal(other.cutoff_at, 1000, 'a different user\'s row must be untouched');
  assert.equal(recapRows.length, 2);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
