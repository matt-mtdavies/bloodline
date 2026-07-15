/**
 * Unit tests for functions/api/tree.js's PUT handler — specifically the D1
 * round-trip reduction (merged SELECT, batched writes) done in response to
 * live 503/sync reports on a large production tree. Mocks env.DB with a
 * lightweight fake that records every call, so these tests verify the exact
 * grouping of statements (not just that a save "works") without needing a
 * real D1 binding. Behavior-preservation is the whole point of this refactor,
 * so every pre-existing guard (conflict detection, contributor/editor
 * permission limits, defensive isolation of the snapshot/activity_log
 * best-effort writes) is re-verified here alongside the new batching.
 * Run with: node tests/tree-save.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPut } from '../functions/api/tree.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

// A minimal fake D1 binding: prepare/bind returns a Statement recording its
// own SQL text + bound args; first()/run()/all() resolve from canned data;
// batch() records the whole group as one call and executes each statement's
// effect in order, so a `batchShouldThrow` substring can simulate exactly
// the "table doesn't exist yet" failure mode the real defensive try/catch
// blocks are written against.
function makeFakeDB({ userRow = null, membershipRow, existingTreeRow = null, batchShouldThrow = null, adminRows = [] } = {}) {
  const calls = [];
  function makeStatement(sql) {
    let boundArgs = [];
    const stmt = {
      bind(...args) { boundArgs = args; return stmt; },
      async first() {
        calls.push({ type: 'first', sql, args: boundArgs });
        if (/FROM user WHERE id/.test(sql)) return userRow;
        if (/FROM family_member WHERE user_id = \? AND family_id/.test(sql)) return membershipRow;
        if (/FROM family_member WHERE user_id/.test(sql)) return membershipRow;
        if (/FROM family_tree WHERE family_id/.test(sql)) return existingTreeRow;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args: boundArgs });
        if (batchShouldThrow && sql.includes(batchShouldThrow)) throw new Error('simulated failure: ' + sql.slice(0, 40));
        return { success: true };
      },
      async all() {
        calls.push({ type: 'all', sql, args: boundArgs });
        if (/family_member fm JOIN user u/.test(sql)) return { results: adminRows };
        return { results: [] };
      },
      __sql: sql,
      __args: () => boundArgs,
    };
    return stmt;
  }
  return {
    calls,
    prepare: (sql) => makeStatement(sql),
    async batch(stmts) {
      const group = stmts.map((s) => ({ sql: s.__sql, args: s.__args() }));
      calls.push({ type: 'batch', group });
      if (batchShouldThrow && group.some((g) => g.sql.includes(batchShouldThrow))) {
        throw new Error('simulated batch failure containing: ' + batchShouldThrow);
      }
      return group.map(() => ({ success: true }));
    },
  };
}

function makeRequest(body, headers = {}) {
  return { json: async () => body, headers: { get: (k) => headers[k] ?? null } };
}

const OWNER_USER = { uid: 'u1', family_id: null };
const OWNER_MEMBERSHIP = { family_id: 'fam1', role: 'owner' };

await test('a normal save reads family_tree exactly once (merged SELECT, not two)', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [{ id: 'p1' }] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  const res = await onRequestPut({
    request: makeRequest({ people: [{ id: 'p1' }], familyName: 'Test' }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  const familyTreeSelects = db.calls.filter((c) => c.type === 'first' && /FROM family_tree WHERE family_id/.test(c.sql));
  assert.equal(familyTreeSelects.length, 1, 'expected exactly one SELECT against family_tree');
  assert.match(familyTreeSelects[0].sql, /tree_json.*updated_at|updated_at.*tree_json/s);
});

await test('the snapshot insert and its cleanup are batched together as one call', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  await onRequestPut({ request: makeRequest({ people: [] }), env: { DB: db }, data: { user: OWNER_USER } });
  const batches = db.calls.filter((c) => c.type === 'batch');
  const snapshotBatch = batches.find((b) => b.group.some((g) => g.sql.includes('family_tree_snapshot')));
  assert.ok(snapshotBatch, 'expected a batch call touching family_tree_snapshot');
  assert.equal(snapshotBatch.group.length, 2, 'expected exactly 2 statements: the insert and the cleanup delete');
  assert.match(snapshotBatch.group[0].sql, /INSERT INTO family_tree_snapshot/);
  assert.match(snapshotBatch.group[1].sql, /DELETE FROM family_tree_snapshot/);
});

await test('no snapshot batch is issued when there is no existing tree yet (first-ever save)', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  await onRequestPut({ request: makeRequest({ people: [] }), env: { DB: db }, data: { user: OWNER_USER } });
  const batches = db.calls.filter((c) => c.type === 'batch');
  assert.ok(!batches.some((b) => b.group.some((g) => g.sql.includes('family_tree_snapshot'))));
});

await test('the main tree upsert and family-name update are batched together', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  await onRequestPut({
    request: makeRequest({ people: [], familyName: 'The Smiths' }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  const batches = db.calls.filter((c) => c.type === 'batch');
  const writeBatch = batches.find((b) => b.group.some((g) => g.sql.includes('INSERT INTO family_tree ')));
  assert.ok(writeBatch);
  assert.equal(writeBatch.group.length, 2, 'expected the tree upsert + the family name update together');
  assert.match(writeBatch.group[1].sql, /UPDATE family SET name/);
});

await test('the family-name statement is omitted from the batch when no familyName is set', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  await onRequestPut({ request: makeRequest({ people: [] }), env: { DB: db }, data: { user: OWNER_USER } });
  const batches = db.calls.filter((c) => c.type === 'batch');
  const writeBatch = batches.find((b) => b.group.some((g) => g.sql.includes('INSERT INTO family_tree ')));
  assert.equal(writeBatch.group.length, 1, 'expected just the tree upsert, no name update');
});

await test('multiple new activity events in one save are batched into a single call, not one per event', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  const activity = [
    { id: 'a1', type: 'person_added', created_at: '2026-01-01T00:00:00Z' },
    { id: 'a2', type: 'person_added', created_at: '2026-01-01T00:00:01Z' },
    { id: 'a3', type: 'memory_added', created_at: '2026-01-01T00:00:02Z' },
  ];
  await onRequestPut({ request: makeRequest({ people: [], activity }), env: { DB: db }, data: { user: OWNER_USER } });
  const batches = db.calls.filter((c) => c.type === 'batch');
  const activityBatch = batches.find((b) => b.group.some((g) => g.sql.includes('activity_log')));
  assert.ok(activityBatch, 'expected one batch call for activity_log');
  assert.equal(activityBatch.group.length, 3, 'all 3 fresh events should be in the same batch');
});

await test('no activity_log batch is issued when there are no new events (avoids calling batch([]))', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ activity: [{ id: 'a1' }] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  // Same event id already on the server — nothing fresh to log.
  await onRequestPut({
    request: makeRequest({ people: [], activity: [{ id: 'a1', type: 'person_added', created_at: '2026-01-01T00:00:00Z' }] }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  const batches = db.calls.filter((c) => c.type === 'batch');
  assert.ok(!batches.some((b) => b.group.some((g) => g.sql.includes('activity_log'))));
});

await test('If-Match mismatch still returns 409 from the merged SELECT, before any write happens', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  const res = await onRequestPut({
    request: makeRequest({ people: [] }, { 'If-Match': '"999"' }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 409);
  assert.ok(!db.calls.some((c) => c.type === 'batch'), 'no writes should happen after a 409');
});

await test('If-Match matching the current updated_at proceeds normally', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  const res = await onRequestPut({
    request: makeRequest({ people: [] }, { 'If-Match': '"1000"' }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
});

await test('a snapshot batch failure (e.g. table not yet migrated) does not block the actual save', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [] }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow, batchShouldThrow: 'family_tree_snapshot' });
  const res = await onRequestPut({ request: makeRequest({ people: [] }), env: { DB: db }, data: { user: OWNER_USER } });
  assert.equal(res.status, 200, 'the save itself must still succeed');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(db.calls.some((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('INSERT INTO family_tree '))),
    'the main tree write should still have been attempted after the snapshot batch failed');
});

await test('an activity_log batch failure does not block the actual save', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null, batchShouldThrow: 'activity_log' });
  const res = await onRequestPut({
    request: makeRequest({ people: [], activity: [{ id: 'a1', type: 'person_added', created_at: '2026-01-01T00:00:00Z' }] }),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
});

await test('a failure in the main tree-write batch is a real error (500), not silently swallowed', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null, batchShouldThrow: 'INSERT INTO family_tree ' });
  const res = await onRequestPut({ request: makeRequest({ people: [] }), env: { DB: db }, data: { user: OWNER_USER } });
  assert.equal(res.status, 500);
});

await test('a contributor save is still limited to memories/photos, structure preserved from the server copy', async () => {
  const existingTreeRow = {
    tree_json: JSON.stringify({ people: [{ id: 'p1' }, { id: 'p2' }], memories: [], photos: [], activity: [] }),
    updated_at: 1000,
  };
  const db = makeFakeDB({ membershipRow: { family_id: 'fam1', role: 'contributor' }, existingTreeRow });
  const res = await onRequestPut({
    // A contributor's payload tries to add a memory AND smuggle in a people[] change — only the memory should land.
    request: makeRequest({ people: [{ id: 'p1' }], memories: [{ id: 'm1', text: 'hi' }] }),
    env: { DB: db },
    data: { user: { uid: 'u2', family_id: null } },
  });
  assert.equal(res.status, 200);
  const writeBatch = db.calls.find((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('INSERT INTO family_tree ')));
  const storedJson = writeBatch.group[0].args[1];
  const stored = JSON.parse(storedJson);
  assert.equal(stored.people.length, 2, 'people must be preserved from the server copy, not the contributor\'s trimmed payload');
  assert.deepEqual(stored.memories.map((m) => m.id), ['m1']);
});

// Builds a payload whose serialized JSON is at least `targetBytes` long, by
// padding a single person's notes field with filler text — the exact shape
// doesn't matter to the size guard, only the resulting byte count of the
// final tree_json.
function payloadOfSize(targetBytes) {
  const base = { people: [{ id: 'p1', notes: '' }] };
  const overhead = new TextEncoder().encode(JSON.stringify(base)).length;
  const filler = 'x'.repeat(Math.max(0, targetBytes - overhead));
  return { people: [{ id: 'p1', notes: filler }] };
}

await test('a save comfortably under both size thresholds has no sizeWarning', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(1000)),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.sizeWarning, undefined);
});

await test('a save between the warn and hard-stop thresholds still succeeds, with a sizeWarning', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(850_000)),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.sizeWarning, 'expected a sizeWarning on the success response');
  assert.ok(body.sizeWarning.bytes > 800_000);
  assert.equal(body.sizeWarning.limitBytes, 1_048_576);
  assert.ok(db.calls.some((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('INSERT INTO family_tree '))),
    'the save must still have actually written');
});

await test('a non-admin save crossing the warn threshold has no sizeWarning on screen (only owner/coadmin see it)', async () => {
  const db = makeFakeDB({ membershipRow: { family_id: 'fam1', role: 'editor' }, existingTreeRow: null });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(850_000)),
    env: { DB: db },
    data: { user: { uid: 'u4', family_id: null } },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sizeWarning, undefined, 'a non-admin saver should not get the on-screen toast');
});

await test('a save that newly crosses the warn threshold looks up owner/coadmin to email, regardless of who saved', async () => {
  const db = makeFakeDB({
    membershipRow: { family_id: 'fam1', role: 'editor' }, // the saver isn't an admin…
    existingTreeRow: null, // …but the crossing must still be reported to whoever IS.
    adminRows: [{ email: 'owner@example.com' }, { email: 'coadmin@example.com' }],
  });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(850_000)),
    env: { DB: db },
    data: { user: { uid: 'u5', family_id: null } },
  });
  assert.equal(res.status, 200);
  const adminLookup = db.calls.find((c) => c.type === 'all' && /family_member fm JOIN user u/.test(c.sql));
  assert.ok(adminLookup, 'expected the admin-email lookup to run on a newly-crossing save');
  assert.match(adminLookup.sql, /role IN \('owner', 'coadmin'\)/);
});

await test('a save that was ALREADY above the warn threshold does not re-trigger the admin email lookup', async () => {
  const existingTreeRow = { tree_json: JSON.stringify(payloadOfSize(850_000)), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(860_000)),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.sizeWarning, 'the on-screen toast still shows for an admin saver while still above the threshold');
  assert.ok(!db.calls.some((c) => c.type === 'all' && /family_member fm JOIN user u/.test(c.sql)),
    'no repeat email lookup once the tree is already known to be over the threshold');
});

await test('a save that stays comfortably under the warn threshold never triggers the admin email lookup', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  await onRequestPut({ request: makeRequest(payloadOfSize(1000)), env: { DB: db }, data: { user: OWNER_USER } });
  assert.ok(!db.calls.some((c) => c.type === 'all' && /family_member fm JOIN user u/.test(c.sql)));
});

await test('a save at or above the hard-stop threshold is rejected with 413 and no writes attempted', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  const res = await onRequestPut({
    request: makeRequest(payloadOfSize(995_000)),
    env: { DB: db },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.ok(body.detail, 'expected a human-readable detail message');
  assert.ok(!db.calls.some((c) => c.type === 'batch'), 'no writes should be attempted when the save is rejected for size');
});

await test('an editor cannot remove a person — 403, no write attempted', async () => {
  const existingTreeRow = {
    tree_json: JSON.stringify({ people: [{ id: 'p1' }, { id: 'p2' }] }),
    updated_at: 1000,
  };
  const db = makeFakeDB({ membershipRow: { family_id: 'fam1', role: 'editor' }, existingTreeRow });
  const res = await onRequestPut({
    request: makeRequest({ people: [{ id: 'p1' }] }), // p2 silently dropped
    env: { DB: db },
    data: { user: { uid: 'u3', family_id: null } },
  });
  assert.equal(res.status, 403);
  assert.ok(!db.calls.some((c) => c.type === 'batch'), 'no writes should happen when the removal is rejected');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
