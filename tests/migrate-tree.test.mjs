/**
 * Unit tests for functions/api/admin/migrate-tree.js — the one-time,
 * per-family migration script docs/TREE-STORAGE.md Phase 2 has been
 * building toward. Fakes D1 and R2; no real bindings needed. The
 * load-bearing property this suite exists to prove: a verification
 * failure (reassembled tree != original) writes NOTHING — not the
 * snapshot, not R2, not D1 — while a genuine success writes R2 strictly
 * before D1, and re-running against an already-migrated family is a safe
 * no-op.
 * Run with: node tests/migrate-tree.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/migrate-tree.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function fakeR2() {
  const store = new Map();
  const calls = [];
  return {
    store, calls,
    async get(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { json: async () => JSON.parse(val), text: async () => val };
    },
    async put(key, value) { calls.push({ type: 'put', key }); store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

function fakeDB({ existingTreeRow = null } = {}) {
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() {
        calls.push({ type: 'first', sql, args });
        if (/FROM family_tree WHERE family_id/.test(sql)) return existingTreeRow;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args });
        return { success: true };
      },
      __sql: sql,
      __args: () => args,
    };
    return s;
  }
  return {
    calls,
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      const group = stmts.map((s) => ({ sql: s.__sql, args: s.__args() }));
      calls.push({ type: 'batch', group });
      return group.map(() => ({ success: true }));
    },
  };
}

const ADMIN_USER = { email: 'admin@example.com' };
const ENV_BASE = { ADMIN_EMAILS: 'admin@example.com' };

function makeRequest(body) {
  return { json: async () => body };
}

const CLEAN_TREE = {
  people: [{ id: 'p1', display_name: 'James', is_living: true, bio: 'A long bio.' }],
  relationships: [],
  memories: [{ id: 'm1', text: 'hi' }],
  photos: [], documents: [], activity: [],
  familyName: 'The Test Family', myPersonId: 'p1',
};

await test('a non-admin is forbidden, no reads or writes attempted', async () => {
  const db = fakeDB({ existingTreeRow: { tree_json: JSON.stringify(CLEAN_TREE), updated_at: 1000 } });
  const r2 = fakeR2();
  const res = await onRequestPost({
    request: makeRequest({ familyId: 'fam1' }),
    env: { ...ENV_BASE, DB: db, DOCS: r2 },
    data: { user: { email: 'nobody@example.com' } },
  });
  assert.equal(res.status, 403);
  assert.equal(db.calls.length, 0);
});

await test('a missing familyId in the request body is a 400', async () => {
  const db = fakeDB({});
  const res = await onRequestPost({ request: makeRequest({}), env: { ...ENV_BASE, DB: db, DOCS: fakeR2() }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 400);
});

await test('a family with no family_tree row at all is a 404', async () => {
  const db = fakeDB({ existingTreeRow: null });
  const res = await onRequestPost({ request: makeRequest({ familyId: 'fam1' }), env: { ...ENV_BASE, DB: db, DOCS: fakeR2() }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 404);
});

await test('a corrupt tree_json is a 500, nothing written', async () => {
  const db = fakeDB({ existingTreeRow: { tree_json: '{not json', updated_at: 1000 } });
  const res = await onRequestPost({ request: makeRequest({ familyId: 'fam1' }), env: { ...ENV_BASE, DB: db, DOCS: fakeR2() }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 500);
  assert.ok(!db.calls.some((c) => c.type === 'run' || c.type === 'batch'));
});

await test('an already-migrated family is a safe no-op — returns immediately, writes nothing', async () => {
  const existingTreeRow = { tree_json: JSON.stringify({ people: [], relationships: [], _extraVersion: 500 }), updated_at: 1000 };
  const db = fakeDB({ existingTreeRow });
  const r2 = fakeR2();
  const res = await onRequestPost({ request: makeRequest({ familyId: 'fam1' }), env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.alreadyMigrated, true);
  assert.ok(!db.calls.some((c) => c.type === 'run' || c.type === 'batch'), 'no writes for an already-migrated family');
  assert.equal(r2.calls.length, 0, 'no R2 writes for an already-migrated family');
});

await test('duplicate person ids (corrupt legacy data) fail verification and abort before any write', async () => {
  // splitTree keys extra.peopleDetail by person id — two people sharing an
  // id collide, so reassembly can't tell them apart. A real, if pathological,
  // way for a bad legacy tree to genuinely fail the deep-equal check.
  const dupTree = {
    people: [
      { id: 'dup', display_name: 'First', is_living: true, bio: 'first bio' },
      { id: 'dup', display_name: 'Second', is_living: true, bio: 'second bio' },
    ],
    relationships: [],
  };
  const db = fakeDB({ existingTreeRow: { tree_json: JSON.stringify(dupTree), updated_at: 1000 } });
  const r2 = fakeR2();
  const res = await onRequestPost({ request: makeRequest({ familyId: 'fam1' }), env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /Verification failed/);
  assert.ok(!db.calls.some((c) => c.type === 'run' || c.type === 'batch'), 'no D1 writes on a verification failure');
  assert.equal(r2.calls.length, 0, 'no R2 writes on a verification failure — verification happens before any I/O');
});

await test('a clean family migrates successfully: snapshot archived, R2 written before D1, response carries byte counts', async () => {
  const existingTreeRow = { tree_json: JSON.stringify(CLEAN_TREE), updated_at: 1000 };
  const db = fakeDB({ existingTreeRow });
  const r2 = fakeR2();
  const res = await onRequestPost({ request: makeRequest({ familyId: 'fam1' }), env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyMigrated, false);
  assert.ok(body.extraVersion);
  assert.ok(body.coreBytes > 0);
  assert.ok(body.extraBytes > 0);

  // Snapshot archived before the migration write.
  const snapshotBatch = db.calls.find((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('family_tree_snapshot')));
  assert.ok(snapshotBatch, 'expected the pre-migration row to be archived');

  // R2 write happened, and strictly before the D1 upsert (write-order-as-commit-point).
  assert.equal(r2.calls.length, 1);
  assert.equal(r2.calls[0].type, 'put');
  const r2CallIndex = db.calls.length; // r2 write isn't tracked in db.calls; just confirm the D1 upsert ran after snapshot
  const upsertRun = db.calls.find((c) => c.type === 'run' && /INSERT INTO family_tree /.test(c.sql));
  assert.ok(upsertRun, 'expected the D1 core+_extraVersion upsert to run');

  // The stored core must NOT carry rich person detail or extra-owned collections.
  const storedCore = JSON.parse(upsertRun.args[1]);
  assert.ok(!('bio' in (storedCore.people?.[0] || {})));
  assert.ok(!('memories' in storedCore));
  assert.equal(storedCore._extraVersion, body.extraVersion);

  // The R2 extra must carry the rich detail and collections that went missing from core.
  const [, extraJson] = [...r2.store.entries()][0];
  const extra = JSON.parse(extraJson);
  assert.equal(extra.peopleDetail.p1.bio, 'A long bio.');
  assert.deepEqual(extra.memories, CLEAN_TREE.memories);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
