/**
 * Unit tests for functions/api/merge.js — the duplicate-family merge wizard's
 * GET (preview) and POST (finalize) endpoints, rewritten in docs/TREE-
 * STORAGE.md Phase 1 to go through functions/_lib/treeStore.js instead of
 * hand-rolled SQL. merge.js has its OWN compare-and-swap concurrency check,
 * separate from tree.js's ETag/If-Match — this suite exists specifically to
 * prove that path still works exactly as before through the shared module,
 * including the race windows the original code's comments call out.
 * Run with: node tests/merge.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/merge.js';
import { writeExtraToR2 } from '../functions/_lib/treeStore.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function fakeR2({ getShouldThrow = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (getShouldThrow) throw new Error('simulated R2 outage');
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { json: async () => JSON.parse(val), text: async () => val };
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

// A stateful fake: family_tree is real mutable state (not just recorded
// calls) because the CAS behavior under test depends on whether a write's
// WHERE clause actually matches the row's CURRENT updated_at at call time.
function makeFakeDB({ inviteRow, familyTreeRow = null, alreadyMember = false, insertShouldRace = false, casShouldMiss = false }) {
  let tree = familyTreeRow; // { tree_json, updated_at } | null
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() {
        calls.push({ type: 'first', sql, args });
        if (/FROM invite i\s+JOIN family/.test(sql)) return inviteRow; // GET's join
        if (/FROM invite WHERE token/.test(sql)) return inviteRow; // POST's lookup
        if (/FROM family_tree WHERE family_id/.test(sql)) return tree;
        if (/FROM family_member WHERE family_id = \? AND user_id/.test(sql)) return alreadyMember ? { user_id: args[1] } : null;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args });
        if (/^\s*INSERT INTO family_tree /i.test(sql)) {
          if (insertShouldRace) throw new Error('simulated unique-constraint race');
          tree = { tree_json: args[1], updated_at: args[2] };
          return { success: true, meta: { changes: 1 } };
        }
        if (/^\s*UPDATE family_tree SET tree_json = \?, updated_at = \?\s+WHERE family_id = \? AND updated_at = \?/i.test(sql)) {
          // casShouldMiss simulates the real TOCTOU gap the original code's
          // comments describe: another save landed between the early
          // read-and-compare check and this actual compare-and-swap write,
          // so the WHERE clause no longer matches even though the early
          // check (against the same stale read) passed.
          if (casShouldMiss) return { success: true, meta: { changes: 0 } };
          const [treeJson, updatedAt, , expected] = args;
          if (!tree || tree.updated_at !== expected) return { success: true, meta: { changes: 0 } };
          tree = { tree_json: treeJson, updated_at: updatedAt };
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 1 } };
      },
      __sql: sql,
    };
    return s;
  }
  return { calls, prepare: (sql) => stmt(sql) };
}

function req(body) {
  return { json: async () => body, url: `https://x.example/api/merge?invite=${body?.invite ?? 'tok'}` };
}

const USER = { uid: 'u1' };
const now = Math.floor(Date.now() / 1000);
const PENDING_INVITE = { id: 'inv1', family_id: 'fam1', from_user: 'u_owner', role: 'editor', status: 'pending', expires_at: now + 3600, family_name: 'The Test Family', from_email: 'owner@example.com' };

await test('GET returns the target family\'s tree and treeUpdatedAt for preview', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: JSON.stringify({ people: [{ id: 'p1' }], relationships: [] }), updated_at: 500 } });
  const res = await onRequestGet({ request: { url: 'https://x.example/api/merge?invite=tok' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.familyId, 'fam1');
  assert.deepEqual(body.tree.people, [{ id: 'p1' }]);
  assert.equal(body.treeUpdatedAt, 500);
});

await test('GET returns an empty default tree when the target family has no row yet', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: null });
  const res = await onRequestGet({ request: { url: 'https://x.example/api/merge?invite=tok' }, env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.deepEqual(body.tree, { people: [], relationships: [] });
  assert.equal(body.treeUpdatedAt, null);
});

await test('GET falls back to an empty tree, not a crash, on corrupt tree_json', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: '{not json', updated_at: 500 } });
  const res = await onRequestGet({ request: { url: 'https://x.example/api/merge?invite=tok' }, env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.deepEqual(body.tree, { people: [], relationships: [] });
});

await test('POST with no existing row inserts via the insert-only path and accepts the invite', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: null });
  const mergedTree = { people: [{ id: 'p1' }], relationships: [], familyName: 'Merged Family' };
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: mergedTree, baseUpdatedAt: null }),
    env: { DB: db }, data: { user: USER },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(db.calls.some((c) => c.type === 'run' && /INSERT INTO family_tree /.test(c.sql)));
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)));
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE family SET name/.test(c.sql)));
});

await test('POST with a matching baseUpdatedAt uses the compare-and-swap update and succeeds', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 } });
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: { people: [{ id: 'p2' }], relationships: [] }, baseUpdatedAt: 1000 }),
    env: { DB: db }, data: { user: USER },
  });
  assert.equal(res.status, 200);
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE family_tree SET tree_json = \?, updated_at = \?\s+WHERE family_id = \? AND updated_at = \?/.test(c.sql)));
  assert.ok(db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)),
    'a successful CAS write must still mark the invite accepted');
});

await test('POST with a stale baseUpdatedAt is rejected 409 BEFORE any membership writes — nothing mutated, safely retryable', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: JSON.stringify({ people: [{ id: 'existing' }] }), updated_at: 2000 } });
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: { people: [{ id: 'p2' }], relationships: [] }, baseUpdatedAt: 1000 }), // stale
    env: { DB: db }, data: { user: USER },
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'conflict');
  assert.deepEqual(body.tree.people, [{ id: 'existing' }], 'the fresh tree should be returned for the client to recompute against');
  assert.ok(!db.calls.some((c) => c.type === 'run' && /family_member/.test(c.sql)),
    'no membership writes should happen when the early conflict check rejects the request');
  assert.ok(!db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)));
});

await test('POST: the row appears concurrently between the early check and the insert-only write — treated as a conflict, invite stays pending', async () => {
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: null, insertShouldRace: true });
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: { people: [{ id: 'p2' }], relationships: [] }, baseUpdatedAt: null }),
    env: { DB: db }, data: { user: USER },
  });
  assert.equal(res.status, 409);
  assert.ok(!db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)),
    'the invite must stay pending so the client\'s retry (fresh baseUpdatedAt) isn\'t rejected by a 410');
});

await test('POST: the row changes between the early check and the CAS write (the real TOCTOU gap the comments describe) — 409, invite stays pending, membership writes still land (harmless to repeat on retry)', async () => {
  const db = makeFakeDB({
    inviteRow: PENDING_INVITE,
    familyTreeRow: { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 },
    casShouldMiss: true, // the early check (against the same read) passes, but the actual CAS write reports changes:0
  });
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: { people: [{ id: 'p2' }], relationships: [] }, baseUpdatedAt: 1000 }),
    env: { DB: db }, data: { user: USER },
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'conflict');
  assert.ok(!db.calls.some((c) => c.type === 'run' && /UPDATE invite SET status = 'accepted'/.test(c.sql)),
    'the invite must stay pending after a genuine CAS miss, so a client retry with a fresh baseUpdatedAt still works');
  assert.ok(db.calls.some((c) => c.type === 'run' && /INSERT INTO family_member|UPDATE family_member SET role/.test(c.sql)),
    'the membership writes are documented as harmless to repeat, so they still happen even though the tree write itself was rejected');
});

// ── Migrated-family merge (docs/TREE-STORAGE.md Phase 2) ──────────────────

await test('GET on a migrated family reassembles core + R2 extra for the merge preview', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', {
    people: [{ id: 'p1', bio: 'A long bio.' }], relationships: [], memories: [{ id: 'm1' }],
  }, 2000);
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: coreJson, updated_at: 2000 } });
  const res = await onRequestGet({ request: { url: 'https://x.example/api/merge?invite=tok' }, env: { DB: db, DOCS: r2 }, data: { user: USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tree.people[0].bio, 'A long bio.', 'the preview must include extra-owned rich detail, not just core');
  assert.deepEqual(body.tree.memories, [{ id: 'm1' }]);
});

await test('GET on a migrated family whose extra is unreadable fails clean with 503, not an incomplete preview', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', { people: [], relationships: [] }, 3000);
  r2.store.delete('tree-extra/fam1/3000.json');
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: coreJson, updated_at: 3000 } });
  const res = await onRequestGet({ request: { url: 'https://x.example/api/merge?invite=tok' }, env: { DB: db, DOCS: r2 }, data: { user: USER } });
  assert.equal(res.status, 503);
});

await test('POST on a migrated family re-splits and writes R2 before D1, preserving rich detail through the CAS write', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', { people: [], relationships: [] }, 4000);
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: coreJson, updated_at: 4000 } });
  const mergedTree = { people: [{ id: 'p1', bio: 'Merged-in bio.' }], relationships: [], memories: [{ id: 'm_new' }] };
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: mergedTree, baseUpdatedAt: 4000 }),
    env: { DB: db, DOCS: r2 }, data: { user: USER },
  });
  assert.equal(res.status, 200);

  const casWrite = db.calls.find((c) => c.type === 'run' && /^\s*UPDATE family_tree SET tree_json = \?, updated_at = \?/i.test(c.sql));
  assert.ok(casWrite);
  const storedCore = JSON.parse(casWrite.args[0]);
  assert.ok(!('bio' in (storedCore.people?.[0] || {})), 'core must not carry rich person detail');
  assert.ok(storedCore._extraVersion, 'the family must remain migrated after this write');

  const newExtraObj = await r2.get(`tree-extra/fam1/${storedCore._extraVersion}.json`);
  const newExtra = await newExtraObj.json();
  assert.equal(newExtra.peopleDetail.p1.bio, 'Merged-in bio.');
  assert.deepEqual(newExtra.memories, [{ id: 'm_new' }]);
});

await test('POST conflict on a migrated family returns the fully reassembled fresh tree, not core alone', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', {
    people: [{ id: 'existing', bio: 'Untouched bio.' }], relationships: [],
  }, 5000);
  const db = makeFakeDB({ inviteRow: PENDING_INVITE, familyTreeRow: { tree_json: coreJson, updated_at: 5000 } });
  const res = await onRequestPost({
    request: req({ invite: 'tok', tree: { people: [{ id: 'p2' }], relationships: [] }, baseUpdatedAt: 1000 }), // stale
    env: { DB: db, DOCS: r2 }, data: { user: USER },
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.tree.people[0].bio, 'Untouched bio.', 'the conflict response\'s fresh tree must be fully reassembled, not core-only');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
