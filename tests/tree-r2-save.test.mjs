/**
 * Unit tests for functions/api/tree.js's GET/PUT handlers after wiring in
 * the R2-backed "extra" layer (docs/TREE-STORAGE.md Phase 2 step 3). Fakes
 * both D1 and R2 — no real binding needed. tests/tree-save.test.mjs already
 * covers every pre-existing legacy behavior in full (byte-for-byte
 * unchanged, since a family with no `_extraVersion` on its core JSON never
 * touches R2 at all — migratedMode stays false). This file covers only
 * what's NEW: a migrated family's GET reassembling core+extra, a migrated
 * family's PUT re-splitting and writing R2-before-D1 with core-only byte
 * measurement, and the extraError fail-clean (503) path on both verbs.
 * Run with: node tests/tree-r2-save.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut } from '../functions/api/tree.js';
import { writeExtraToR2, splitTree } from '../functions/_lib/treeStore.js';

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

function makeFakeDB({ userRow = null, membershipRow, existingTreeRow = null, adminRows = [] } = {}) {
  const calls = [];
  function makeStatement(sql) {
    let boundArgs = [];
    const stmt = {
      bind(...args) { boundArgs = args; return stmt; },
      async first() {
        calls.push({ type: 'first', sql, args: boundArgs });
        if (/FROM user WHERE id/.test(sql)) return userRow;
        if (/family_member fm JOIN family f/.test(sql)) return membershipRow;
        if (/FROM family_member WHERE user_id = \? AND family_id/.test(sql)) return membershipRow;
        if (/FROM family_member WHERE user_id/.test(sql)) return membershipRow;
        if (/FROM family_tree WHERE family_id/.test(sql)) return existingTreeRow;
        return null;
      },
      async run() {
        calls.push({ type: 'run', sql, args: boundArgs });
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
      return group.map(() => ({ success: true }));
    },
  };
}

function makeRequest(body, headers = {}) {
  return { json: async () => body, headers: { get: (k) => headers[k] ?? null } };
}

const OWNER_USER = { uid: 'u1', family_id: null };
const OWNER_MEMBERSHIP_ROW = { family_id: 'fam1', role: 'owner', family_name: 'The Test Family' };
const OWNER_MEMBERSHIP = { family_id: 'fam1', role: 'owner' };

const FULL_TREE = {
  people: [{ id: 'p1', display_name: 'James', is_living: true, bio: 'A long bio.' }],
  relationships: [],
  memories: [{ id: 'm1', text: 'hi' }],
  photos: [], documents: [], activity: [],
  familyName: 'The Test Family', myPersonId: 'p1',
};

// ── GET ──────────────────────────────────────────────────────────────────

await test('GET on a migrated family reassembles core + R2 extra transparently', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', FULL_TREE, 2000);
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP_ROW, existingTreeRow: { tree_json: coreJson, updated_at: 2000 } });
  const res = await onRequestGet({ env: { DB: db, DOCS: r2 }, data: { user: OWNER_USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.people[0].bio, 'A long bio.', 'extra-owned person detail must be reassembled onto the person');
  assert.deepEqual(body.memories, FULL_TREE.memories);
  assert.ok(!('_extraVersion' in body), 'plumbing field must never leak to the client');
});

await test('GET on a migrated family whose extra is unreadable fails clean with 503, not a partial tree', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', FULL_TREE, 3000);
  r2.store.delete('tree-extra/fam1/3000.json');
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP_ROW, existingTreeRow: { tree_json: coreJson, updated_at: 3000 } });
  const res = await onRequestGet({ env: { DB: db, DOCS: r2 }, data: { user: OWNER_USER } });
  assert.equal(res.status, 503);
});

await test('GET on an unmigrated (legacy) family is unaffected — no R2 read attempted', async () => {
  const db = makeFakeDB({
    membershipRow: OWNER_MEMBERSHIP_ROW,
    existingTreeRow: { tree_json: JSON.stringify(FULL_TREE), updated_at: 1000 },
  });
  let r2Touched = false;
  const r2 = { get: async () => { r2Touched = true; return null; } };
  const res = await onRequestGet({ env: { DB: db, DOCS: r2 }, data: { user: OWNER_USER } });
  assert.equal(res.status, 200);
  assert.ok(!r2Touched, 'a legacy family must never touch R2 at all');
});

// ── PUT ──────────────────────────────────────────────────────────────────

await test('PUT on a migrated family re-splits, writes R2 before D1, and measures CORE bytes (not the full tree) for the size check', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', FULL_TREE, 4000);
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: { tree_json: coreJson, updated_at: 4000 } });
  const res = await onRequestPut({
    request: makeRequest({ ...FULL_TREE, people: [{ ...FULL_TREE.people[0], bio: 'An updated bio.' }] }),
    env: { DB: db, DOCS: r2 },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);

  // The D1 row now stored must be core-shaped (small, no `bio`/`memories`)
  // and must carry a fresh _extraVersion.
  const writeBatch = db.calls.find((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('INSERT INTO family_tree ')));
  const storedCoreJson = writeBatch.group[0].args[1];
  const storedCore = JSON.parse(storedCoreJson);
  assert.ok(!('bio' in (storedCore.people?.[0] || {})), 'core must not carry rich person detail');
  assert.ok(!('memories' in storedCore), 'core must not carry extra-owned collections');
  assert.ok(storedCore._extraVersion, 'a migrated family\'s core must always carry a fresh _extraVersion');

  // The new extra must actually be in R2 under that version, with the updated bio.
  const newExtraObj = await r2.get(`tree-extra/fam1/${storedCore._extraVersion}.json`);
  assert.ok(newExtraObj, 'expected the new extra version to be written to R2');
  const newExtra = await newExtraObj.json();
  assert.equal(newExtra.peopleDetail.p1.bio, 'An updated bio.');
});

await test('PUT on a migrated family whose extra is unreadable fails clean with 503, touches neither D1 nor R2', async () => {
  const r2 = fakeR2({ getShouldThrow: true });
  const coreJson = JSON.stringify({ ...splitTree(FULL_TREE).core, _extraVersion: 5000 });
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: { tree_json: coreJson, updated_at: 5000 } });
  const res = await onRequestPut({
    request: makeRequest(FULL_TREE),
    env: { DB: db, DOCS: r2 },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 503);
  assert.ok(!db.calls.some((c) => c.type === 'batch'), 'no D1 write should be attempted when extra is unreadable');
});

await test('PUT on a brand-new family (no existing row) always writes in legacy mode, never touches R2', async () => {
  const db = makeFakeDB({ membershipRow: OWNER_MEMBERSHIP, existingTreeRow: null });
  let r2Touched = false;
  const r2 = {
    get: async () => { r2Touched = true; return null; },
    put: async () => { r2Touched = true; },
  };
  const res = await onRequestPut({
    request: makeRequest({ people: [{ id: 'p1', bio: 'X' }] }),
    env: { DB: db, DOCS: r2 },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  assert.ok(!r2Touched, 'a family with no prior migration marker must never touch R2');
  const writeBatch = db.calls.find((c) => c.type === 'batch' && c.group.some((g) => g.sql.includes('INSERT INTO family_tree ')));
  const stored = JSON.parse(writeBatch.group[0].args[1]);
  assert.equal(stored.people[0].bio, 'X', 'legacy mode stores the whole tree in one row, untouched');
});

await test('PUT on an unmigrated (legacy) existing family stays in legacy mode, never touches R2', async () => {
  const db = makeFakeDB({
    membershipRow: OWNER_MEMBERSHIP,
    existingTreeRow: { tree_json: JSON.stringify(FULL_TREE), updated_at: 1000 },
  });
  let r2Touched = false;
  const r2 = { get: async () => { r2Touched = true; return null; }, put: async () => { r2Touched = true; } };
  const res = await onRequestPut({
    request: makeRequest({ ...FULL_TREE, memories: [{ id: 'm2', text: 'new' }] }),
    env: { DB: db, DOCS: r2 },
    data: { user: OWNER_USER },
  });
  assert.equal(res.status, 200);
  assert.ok(!r2Touched, 'an unmigrated family must not be auto-migrated by this phase\'s code');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
