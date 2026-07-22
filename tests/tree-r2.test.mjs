/**
 * Unit tests for the R2-backed "extra" layer (functions/_lib/treeStore.js):
 * loadFullTree, writeExtraToR2, pruneExtraVersions — docs/TREE-STORAGE.md
 * Phase 2 step 2. Fakes both D1 and R2 so no real binding is needed. These
 * tests exist specifically to prove the dual-read design (an unmigrated
 * family's row.raw is used as-is; a migrated family's core/extra are
 * reassembled) and the fail-clean behavior when a migrated family's extra
 * genuinely can't be read — the one case that must never silently degrade,
 * per the risk this function's own comments walk through.
 * Run with: node tests/tree-r2.test.mjs
 */
import assert from 'node:assert/strict';
import { loadFullTree, writeExtraToR2, pruneExtraVersions } from '../functions/_lib/treeStore.js';

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

function fakeDB(treeRow) {
  return {
    prepare: (sql) => ({
      bind: () => ({
        async first() {
          if (/FROM family_tree WHERE family_id/.test(sql)) return treeRow;
          return null;
        },
      }),
    }),
  };
}

const FULL_TREE = {
  people: [{ id: 'p1', display_name: 'James', is_living: true, bio: 'A long bio.' }],
  relationships: [],
  memories: [{ id: 'm1', text: 'hi' }],
  photos: [], documents: [], activity: [],
  familyName: 'The Test Family', myPersonId: 'p1',
};

// ── loadFullTree ─────────────────────────────────────────────────────────

await test('no family_tree row at all → null', async () => {
  const result = await loadFullTree({ DB: fakeDB(null), DOCS: fakeR2() }, 'fam1');
  assert.equal(result, null);
});

await test('an unmigrated family (no _extraVersion on core) returns row.raw as-is, migrated:false', async () => {
  const legacyRow = { tree_json: JSON.stringify(FULL_TREE), updated_at: 1000 };
  const result = await loadFullTree({ DB: fakeDB(legacyRow), DOCS: fakeR2() }, 'fam1');
  assert.equal(result.migrated, false);
  assert.equal(result.extraError, null);
  assert.deepEqual(result.tree, FULL_TREE);
});

await test('a migrated family reassembles core + R2 extra correctly', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', FULL_TREE, 2000);
  const row = { tree_json: coreJson, updated_at: 2000 };
  const result = await loadFullTree({ DB: fakeDB(row), DOCS: r2 }, 'fam1');
  assert.equal(result.migrated, true);
  assert.equal(result.extraError, null);
  assert.deepEqual(result.tree, FULL_TREE, 'the reassembled tree must exactly match what was originally written');
  assert.ok(!('_extraVersion' in result.tree), 'the plumbing field must never leak into the client-visible tree');
});

await test('a migrated family whose named extra version is missing from R2 surfaces extraError, does not silently pretend success', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam1', FULL_TREE, 3000);
  r2.store.delete('tree-extra/fam1/3000.json'); // simulate the object having vanished
  const row = { tree_json: coreJson, updated_at: 3000 };
  const result = await loadFullTree({ DB: fakeDB(row), DOCS: r2 }, 'fam1');
  assert.equal(result.migrated, true);
  assert.ok(result.extraError, 'a caller must be able to detect this and fail the request rather than serve an incomplete tree');
  assert.ok(result.extraError.includes('3000'));
});

await test('a genuine R2 read failure (not "missing") also surfaces extraError, not a thrown exception', async () => {
  const r2 = fakeR2({ getShouldThrow: true });
  const coreJson = JSON.stringify({ ...FULL_TREE, people: [{ id: 'p1', display_name: 'James', is_living: true }], _extraVersion: 4000 });
  const row = { tree_json: coreJson, updated_at: 4000 };
  const result = await loadFullTree({ DB: fakeDB(row), DOCS: r2 }, 'fam1');
  assert.equal(result.migrated, true);
  assert.ok(result.extraError.includes('simulated R2 outage'));
});

await test('corrupt CORE json still throws — the R2 layer does not swallow that (same as today\'s behavior for a damaged row)', async () => {
  const row = { tree_json: '{not valid json', updated_at: 1000 };
  await assert.rejects(() => loadFullTree({ DB: fakeDB(row), DOCS: fakeR2() }, 'fam1'));
});

// ── writeExtraToR2 ───────────────────────────────────────────────────────

await test('writeExtraToR2 writes extra under the version-keyed R2 path and returns a core string carrying that version', async () => {
  const r2 = fakeR2();
  const coreJson = await writeExtraToR2({ DOCS: r2 }, 'fam42', FULL_TREE, 5555);
  assert.ok(r2.store.has('tree-extra/fam42/5555.json'));
  const core = JSON.parse(coreJson);
  assert.equal(core._extraVersion, 5555);
  assert.ok(!('memories' in core), 'core must not carry extra-owned collections');
  const storedExtra = JSON.parse(r2.store.get('tree-extra/fam42/5555.json'));
  assert.deepEqual(storedExtra.memories, FULL_TREE.memories);
});

// ── pruneExtraVersions ───────────────────────────────────────────────────

await test('pruneExtraVersions keeps only the most recent N, deletes the rest', async () => {
  const r2 = fakeR2();
  for (const v of [100, 200, 300, 400, 500]) {
    await writeExtraToR2({ DOCS: r2 }, 'famX', FULL_TREE, v);
  }
  const result = await pruneExtraVersions({ DOCS: r2 }, 'famX', 3);
  assert.equal(result.keptCount, 3);
  assert.equal(result.deletedCount, 2);
  const remaining = [...r2.store.keys()].sort();
  assert.deepEqual(remaining, ['tree-extra/famX/300.json', 'tree-extra/famX/400.json', 'tree-extra/famX/500.json']);
});

await test('pruneExtraVersions is a no-op when there are fewer versions than the keep count', async () => {
  const r2 = fakeR2();
  await writeExtraToR2({ DOCS: r2 }, 'famY', FULL_TREE, 1);
  const result = await pruneExtraVersions({ DOCS: r2 }, 'famY', 30);
  assert.equal(result.deletedCount, 0);
  assert.equal(r2.store.size, 1);
});

await test('pruneExtraVersions only touches the requested family\'s prefix, never another family\'s versions', async () => {
  const r2 = fakeR2();
  await writeExtraToR2({ DOCS: r2 }, 'famA', FULL_TREE, 1);
  await writeExtraToR2({ DOCS: r2 }, 'famB', FULL_TREE, 1);
  await pruneExtraVersions({ DOCS: r2 }, 'famA', 0);
  assert.ok(!r2.store.has('tree-extra/famA/1.json'));
  assert.ok(r2.store.has('tree-extra/famB/1.json'), 'a different family\'s version must be untouched');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
