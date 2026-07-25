/**
 * Unit tests for functions/_lib/momentEngagement.js — Family Moments slice
 * 6 silent engagement instrumentation. Same lightweight in-memory D1 fake
 * convention as tests/profileViews.test.mjs.
 * Run with: node tests/momentEngagement.test.mjs
 */
import assert from 'node:assert/strict';
import { recordMomentEngagement } from '../functions/_lib/momentEngagement.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeEnv({ users = [], members = [], families = [] } = {}) {
  const rows = [];

  function first(sql, args) {
    if (sql.includes('SELECT family_id FROM user WHERE id')) {
      const u = users.find((x) => x.id === args[0]);
      return u ? { family_id: u.family_id } : null;
    }
    if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name') && sql.includes('fm.family_id = ?')) {
      const m = members.find((x) => x.user_id === args[0] && x.family_id === args[1]);
      if (!m) return null;
      const f = families.find((x) => x.id === m.family_id);
      return { family_id: m.family_id, role: m.role, family_name: f?.name };
    }
    if (sql.includes('SELECT fm.family_id, fm.role, f.name AS family_name')) {
      const m = members.find((x) => x.user_id === args[0]);
      if (!m) return null;
      const f = families.find((x) => x.id === m.family_id);
      return { family_id: m.family_id, role: m.role, family_name: f?.name };
    }
    throw new Error(`fakeEnv: unhandled .first(): ${sql}`);
  }

  function run(sql, args) {
    if (sql.includes('INSERT INTO family_moment_engagement')) {
      const [viewerUserId, familyId, momentKey, event, occurredAt] = args;
      rows.push({ viewer_user_id: viewerUserId, family_id: familyId, moment_key: momentKey, event, occurred_at: occurredAt });
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

  return { env: { DB: { prepare: (sql) => stmt(sql) } }, rows };
}

const FAM = { id: 'fam_1', name: 'Test Family' };
const USER = { id: 'user_1', family_id: 'fam_1' };
const MEMBER = { user_id: 'user_1', family_id: 'fam_1', role: 'owner' };

await atest('records a "shown" event with the resolved family id and unix-seconds timestamp', async () => {
  const { env, rows } = makeFakeEnv({ users: [USER], members: [MEMBER], families: [FAM] });
  await recordMomentEngagement(env, { viewerUserId: 'user_1', momentKey: 'birthdayToday', event: 'shown', now: 1_700_000_000_000 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    viewer_user_id: 'user_1', family_id: 'fam_1', moment_key: 'birthdayToday', event: 'shown', occurred_at: 1_700_000_000,
  });
});

await atest('records a "tapped" event distinctly from a "shown" event — both persist as separate rows', async () => {
  const { env, rows } = makeFakeEnv({ users: [USER], members: [MEMBER], families: [FAM] });
  await recordMomentEngagement(env, { viewerUserId: 'user_1', momentKey: 'closestCousinsByAge', event: 'shown' });
  await recordMomentEngagement(env, { viewerUserId: 'user_1', momentKey: 'closestCousinsByAge', event: 'tapped' });
  assert.equal(rows.length, 2, 'shown and tapped are append-only, never collapsed into one row');
  assert.deepEqual(rows.map((r) => r.event), ['shown', 'tapped']);
});

await atest('an invalid event is silently ignored — no row written, no throw', async () => {
  const { env, rows } = makeFakeEnv({ users: [USER], members: [MEMBER], families: [FAM] });
  await recordMomentEngagement(env, { viewerUserId: 'user_1', momentKey: 'birthdayToday', event: 'clicked' });
  assert.equal(rows.length, 0);
});

await atest('is a silent no-op when the caller has no resolvable family membership', async () => {
  const { env, rows } = makeFakeEnv({ users: [], members: [], families: [] });
  await recordMomentEngagement(env, { viewerUserId: 'ghost_user', momentKey: 'birthdayToday', event: 'shown' });
  assert.equal(rows.length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
