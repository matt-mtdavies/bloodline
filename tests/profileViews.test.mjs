/**
 * Unit tests for functions/_lib/profileViews.js — "forgotten people"
 * view tracking. Same lightweight in-memory D1 fake convention as
 * tests/exportService.test.mjs (substring-matched SQL, plain arrays).
 * Run with: node tests/profileViews.test.mjs
 */
import assert from 'node:assert/strict';
import { recordProfileView, getLastViewedMap } from '../functions/_lib/profileViews.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeEnv({ users = [], members = [], families = [], views = [] } = {}) {
  const viewRows = views.slice();

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

  function all(sql, args) {
    if (sql.includes('SELECT person_id, viewed_at FROM profile_view')) {
      const [viewerUserId, familyId] = args;
      return viewRows.filter((r) => r.viewer_user_id === viewerUserId && r.family_id === familyId);
    }
    throw new Error(`fakeEnv: unhandled .all(): ${sql}`);
  }

  function run(sql, args) {
    if (sql.includes('INSERT INTO profile_view')) {
      const [viewerUserId, familyId, personId, viewedAt] = args;
      const existing = viewRows.find((r) => r.viewer_user_id === viewerUserId && r.family_id === familyId && r.person_id === personId);
      if (existing) existing.viewed_at = viewedAt;
      else viewRows.push({ viewer_user_id: viewerUserId, family_id: familyId, person_id: personId, viewed_at: viewedAt });
      return { success: true };
    }
    throw new Error(`fakeEnv: unhandled .run(): ${sql}`);
  }

  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() { return first(sql, args); },
      async all() { return { results: all(sql, args) }; },
      async run() { return run(sql, args); },
    };
  }

  return { env: { DB: { prepare: (sql) => stmt(sql) } }, viewRows };
}

const FAM = { id: 'fam_1', name: 'Test Family' };
const USER = { id: 'user_1', family_id: 'fam_1' };
const MEMBER = { user_id: 'user_1', family_id: 'fam_1', role: 'owner' };

await atest('recordProfileView then getLastViewedMap round-trips the timestamp', async () => {
  const { env } = makeFakeEnv({ users: [USER], members: [MEMBER], families: [FAM] });
  await recordProfileView(env, { viewerUserId: 'user_1', personId: 'p_alice', now: 1_700_000_000_000 });
  const map = await getLastViewedMap(env, { viewerUserId: 'user_1' });
  assert.deepEqual(map, { p_alice: 1_700_000_000 });
});

await atest('recordProfileView upserts — a second view of the SAME person updates the timestamp, not a duplicate row', async () => {
  const { env, viewRows } = makeFakeEnv({ users: [USER], members: [MEMBER], families: [FAM] });
  await recordProfileView(env, { viewerUserId: 'user_1', personId: 'p_alice', now: 1_000_000_000_000 });
  await recordProfileView(env, { viewerUserId: 'user_1', personId: 'p_alice', now: 2_000_000_000_000 });
  assert.equal(viewRows.length, 1, 'must never accumulate one row per view — only the latest matters');
  assert.equal(viewRows[0].viewed_at, 2_000_000_000);
});

await atest('getLastViewedMap is scoped strictly to the caller\'s own rows — a different viewer never sees them', async () => {
  const otherUser = { id: 'user_2', family_id: 'fam_1' };
  const otherMember = { user_id: 'user_2', family_id: 'fam_1', role: 'viewer' };
  const { env } = makeFakeEnv({ users: [USER, otherUser], members: [MEMBER, otherMember], families: [FAM] });
  await recordProfileView(env, { viewerUserId: 'user_1', personId: 'p_alice', now: 1_700_000_000_000 });

  const ownMap = await getLastViewedMap(env, { viewerUserId: 'user_1' });
  assert.deepEqual(ownMap, { p_alice: 1_700_000_000 });

  const otherMap = await getLastViewedMap(env, { viewerUserId: 'user_2' });
  assert.deepEqual(otherMap, {}, 'a different family member must never see someone else\'s view history');
});

await atest('recordProfileView is a silent no-op when the caller has no resolvable family membership', async () => {
  const { env, viewRows } = makeFakeEnv({ users: [], members: [], families: [] });
  await recordProfileView(env, { viewerUserId: 'ghost_user', personId: 'p_alice' });
  assert.equal(viewRows.length, 0);
});

await atest('getLastViewedMap returns {} (not an error) when the caller has no resolvable family membership', async () => {
  const { env } = makeFakeEnv({ users: [], members: [], families: [] });
  const map = await getLastViewedMap(env, { viewerUserId: 'ghost_user' });
  assert.deepEqual(map, {});
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
