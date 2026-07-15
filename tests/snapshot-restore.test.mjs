/**
 * Unit tests for functions/api/tree/snapshots/[id].js — restoring a
 * point-in-time backup, rewritten in docs/TREE-STORAGE.md Phase 1 to read/
 * write family_tree through treeStore.js instead of its own inline SQL.
 * This endpoint pre-dates the shared module's batching (tree.js's PUT
 * batches its snapshot insert+prune; this one issues them as two separate
 * calls) — the refactor deliberately preserves that difference rather than
 * silently "improving" it, so this suite pins the two-call shape.
 * Run with: node tests/snapshot-restore.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/tree/snapshots/[id].js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeDB({ membershipRow, snapshotRow, currentTreeRow = null, activityRows = [] }) {
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() {
        calls.push({ type: 'first', sql, args });
        if (/FROM user WHERE id/.test(sql)) return { family_id: 'fam1' };
        if (/FROM family_member WHERE user_id/.test(sql)) return membershipRow;
        if (/FROM family_tree_snapshot WHERE id = \? AND family_id/.test(sql)) return snapshotRow;
        if (/FROM family_tree WHERE family_id/.test(sql)) return currentTreeRow;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args });
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        calls.push({ type: 'all', sql, args });
        return { results: activityRows };
      },
    };
    return s;
  }
  return { calls, prepare: (sql) => stmt(sql) };
}

const OWNER = { role: 'owner' };
const USER = { uid: 'u1' };

await test('a non-owner/coadmin is forbidden, no writes attempted', async () => {
  const db = makeFakeDB({ membershipRow: { role: 'editor' } });
  const res = await onRequestPost({ params: { id: 'snap1' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 403);
  assert.ok(!db.calls.some((c) => c.type === 'run'));
});

await test('a missing snapshot id returns 404', async () => {
  const db = makeFakeDB({ membershipRow: OWNER, snapshotRow: null });
  const res = await onRequestPost({ params: { id: 'nope' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 404);
});

await test('a corrupted snapshot returns 500 without touching anything', async () => {
  const db = makeFakeDB({ membershipRow: OWNER, snapshotRow: { tree_json: '{not json' } });
  const res = await onRequestPost({ params: { id: 'snap1' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 500);
  assert.ok(!db.calls.some((c) => c.type === 'run'));
});

await test('restoring over an existing tree archives it first as TWO separate calls (not batched), then writes the restored tree', async () => {
  const snapshotRow = { tree_json: JSON.stringify({ people: [{ id: 'old_p' }], _seq: 5 }) };
  const currentTreeRow = { tree_json: JSON.stringify({ people: [{ id: 'current_p' }], _seq: 7 }), updated_at: 1000 };
  const db = makeFakeDB({ membershipRow: OWNER, snapshotRow, currentTreeRow });

  const res = await onRequestPost({ params: { id: 'snap1' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 200);

  const archiveInsert = db.calls.find((c) => c.type === 'run' && /INSERT INTO family_tree_snapshot/.test(c.sql));
  const archivePrune = db.calls.find((c) => c.type === 'run' && /DELETE FROM family_tree_snapshot/.test(c.sql));
  const finalWrite = db.calls.find((c) => c.type === 'run' && /INSERT INTO family_tree \(/.test(c.sql));
  assert.ok(archiveInsert, 'the current tree should be archived before being overwritten');
  assert.ok(archivePrune, 'pruning to 30 should run');
  assert.ok(finalWrite, 'the restored tree should be written via the upsert');

  // The two archive calls must be separate run() calls, not one batch() —
  // this endpoint never batches (unlike tree.js's PUT).
  assert.ok(!db.calls.some((c) => c.type === 'batch'), 'this endpoint must not use batch() — preserves its pre-existing behavior exactly');

  const restored = JSON.parse(finalWrite.args[1]);
  assert.equal(restored._seq, 8, 'restored._seq should be currentSeq(7) + 1, not the snapshot\'s own _seq(5)');
  assert.equal(restored.people[0].id, 'old_p', 'the restored content comes from the snapshot, not the current tree');
  assert.ok(restored.people[0].updated_at, 'every restored person should be stamped with a fresh updated_at');
});

await test('restoring when there is no current tree yet skips archiving, currentSeq starts at 0', async () => {
  const snapshotRow = { tree_json: JSON.stringify({ people: [{ id: 'old_p' }] }) };
  const db = makeFakeDB({ membershipRow: OWNER, snapshotRow, currentTreeRow: null });

  const res = await onRequestPost({ params: { id: 'snap1' }, env: { DB: db }, data: { user: USER } });
  assert.equal(res.status, 200);
  assert.ok(!db.calls.some((c) => c.type === 'run' && /family_tree_snapshot/.test(c.sql)),
    'nothing to archive when there was no existing tree');
  const finalWrite = db.calls.find((c) => c.type === 'run' && /INSERT INTO family_tree \(/.test(c.sql));
  const restored = JSON.parse(finalWrite.args[1]);
  assert.equal(restored._seq, 1);
});

await test('restored.activity is repopulated from activity_log, not carried over from the snapshot\'s stale copy', async () => {
  const snapshotRow = { tree_json: JSON.stringify({ people: [], activity: [{ id: 'stale_event' }] }) };
  const activityRows = [{ id: 'fresh1', author_name: 'Jo', author_email: 'j@x.com', type: 'person_added', person_id: 'p1', person_name: 'James', detail: null, created_at: '2026-01-01T00:00:00Z' }];
  const db = makeFakeDB({ membershipRow: OWNER, snapshotRow, currentTreeRow: null, activityRows });

  await onRequestPost({ params: { id: 'snap1' }, env: { DB: db }, data: { user: USER } });
  const finalWrite = db.calls.find((c) => c.type === 'run' && /INSERT INTO family_tree \(/.test(c.sql));
  const restored = JSON.parse(finalWrite.args[1]);
  assert.deepEqual(restored.activity.map((a) => a.id), ['fresh1']);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
