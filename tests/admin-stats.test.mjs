/**
 * Unit tests for functions/api/admin/stats.js's Phase 2 reassembly awareness
 * (docs/TREE-STORAGE.md §9): the content-totals aggregate and the
 * largest_trees size report must both account for a migrated family's data
 * living partly in R2, not just in family_tree.tree_json's core JSON.
 * Fakes D1 (pattern-matching a generic default for every query this
 * endpoint issues, with real fixture data plugged into the two touch
 * points this phase actually changed) and R2. Run with:
 * node tests/admin-stats.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/admin/stats.js';
import { writeExtraToR2 } from '../functions/_lib/treeStore.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function fakeR2({ headShouldThrow = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return { json: async () => JSON.parse(val), text: async () => val };
    },
    async head(key) {
      if (headShouldThrow) throw new Error('simulated R2 outage');
      if (!store.has(key)) return null;
      return { size: new TextEncoder().encode(store.get(key)).length };
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

// A generic fake D1: every query this endpoint issues gets a safe zero/empty
// default (COUNT(*) -> {n:0}, everything else .all() -> {results:[]}) unless
// a `rules` entry (checked in order) matches the SQL text and supplies real
// data — used only for the two queries this phase's fix actually touches.
function fakeDB(rules = []) {
  const calls = [];
  function stmt(sql) {
    let args = [];
    const s = {
      bind(...a) { args = a; return s; },
      async first() {
        calls.push({ type: 'first', sql, args });
        for (const r of rules) {
          if (r.mode === 'first' && r.pattern.test(sql)) return r.value(args);
        }
        if (/COUNT\(\*\) AS n/.test(sql)) return { n: 0 };
        return null;
      },
      async all() {
        calls.push({ type: 'all', sql, args });
        for (const r of rules) {
          if (r.mode === 'all' && r.pattern.test(sql)) return { results: r.value(args) };
        }
        return { results: [] };
      },
    };
    return s;
  }
  return { calls, prepare: (sql) => stmt(sql) };
}

const ADMIN_USER = { email: 'admin@example.com' };
const ENV_BASE = { ADMIN_EMAILS: 'admin@example.com' };

const LEGACY_TREE = {
  people: [{ id: 'p1' }, { id: 'p2' }],
  photos: [{ id: 'ph1' }],
  memories: [{ id: 'm1' }, { id: 'm2' }],
  documents: [],
};
const legacyTreeJson = JSON.stringify(LEGACY_TREE);
const legacyBytes = new TextEncoder().encode(legacyTreeJson).length;

const MIGRATED_TREE = {
  people: [{ id: 'p3', bio: 'X' }, { id: 'p4' }],
  photos: [{ id: 'ph2' }],
  memories: [{ id: 'm3' }],
  documents: [{ id: 'd1' }, { id: 'd2' }],
};

await test('content totals count a migrated family\'s photos/memories/documents via R2 reassembly, not undercounted from core-only tree_json', async () => {
  const r2 = fakeR2();
  const migratedCoreJson = await writeExtraToR2({ DOCS: r2 }, 'fam_migrated', MIGRATED_TREE, 42);
  const migratedCore = JSON.parse(migratedCoreJson);

  const db = fakeDB([
    {
      mode: 'first',
      pattern: /SUM\(CASE WHEN json_extract.*people/s,
      value: () => ({ people: LEGACY_TREE.people.length, photos: LEGACY_TREE.photos.length, memories: LEGACY_TREE.memories.length, documents: LEGACY_TREE.documents.length, migrated_people: migratedCore.people.length }),
    },
    {
      mode: 'all',
      pattern: /SELECT family_id, tree_json FROM family_tree WHERE/,
      value: () => [{ family_id: 'fam_migrated', tree_json: migratedCoreJson }],
    },
  ]);

  const res = await onRequestGet({ env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content.total_people, LEGACY_TREE.people.length + MIGRATED_TREE.people.length);
  assert.equal(body.content.total_photos, LEGACY_TREE.photos.length + MIGRATED_TREE.photos.length);
  assert.equal(body.content.total_memories, LEGACY_TREE.memories.length + MIGRATED_TREE.memories.length);
  assert.equal(body.content.total_documents, LEGACY_TREE.documents.length + MIGRATED_TREE.documents.length);
});

await test('content totals skip (not crash on) a migrated family whose extra is unreadable', async () => {
  const r2 = fakeR2();
  const migratedCoreJson = await writeExtraToR2({ DOCS: r2 }, 'fam_broken', MIGRATED_TREE, 99);
  r2.store.delete('tree-extra/fam_broken/99.json'); // simulate the object having vanished

  const db = fakeDB([
    {
      mode: 'first',
      pattern: /SUM\(CASE WHEN json_extract.*people/s,
      value: () => ({ people: 5, photos: 5, memories: 5, documents: 5, migrated_people: 2 }),
    },
    {
      mode: 'all',
      pattern: /SELECT family_id, tree_json FROM family_tree WHERE/,
      value: () => [{ family_id: 'fam_broken', tree_json: migratedCoreJson }],
    },
  ]);

  const res = await onRequestGet({ env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200, 'the whole dashboard must not fail just because one family\'s extra is unreadable');
  const body = await res.json();
  // photos/memories/documents come ONLY from the bulk (non-migrated) SQL sum here, since the one migrated row was skipped.
  assert.equal(body.content.total_photos, 5);
  assert.equal(body.content.total_memories, 5);
  assert.equal(body.content.total_documents, 5);
  assert.equal(body.content.total_people, 5 + 2, 'people count is unaffected — it never needed the R2 fetch that failed');
});

await test('largest_trees reports a migrated family\'s TRUE total size (core + R2 extra), flagged migrated:true', async () => {
  const r2 = fakeR2();
  const migratedCoreJson = await writeExtraToR2({ DOCS: r2 }, 'fam_migrated', MIGRATED_TREE, 7);
  const migratedCore = JSON.parse(migratedCoreJson);
  const migratedCoreBytes = new TextEncoder().encode(migratedCoreJson).length;
  const extraBytes = new TextEncoder().encode(r2.store.get('tree-extra/fam_migrated/7.json')).length;

  const db = fakeDB([
    {
      mode: 'all',
      pattern: /FROM family_tree ft/,
      value: () => [
        { family_id: 'fam_legacy', family_name: 'Legacy Fam', bytes: legacyBytes, extra_version: null },
        { family_id: 'fam_migrated', family_name: 'Migrated Fam', bytes: migratedCoreBytes, extra_version: migratedCore._extraVersion },
      ],
    },
  ]);

  const res = await onRequestGet({ env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const legacyEntry = body.largest_trees.find((t) => t.family_id === 'fam_legacy');
  const migratedEntry = body.largest_trees.find((t) => t.family_id === 'fam_migrated');
  assert.equal(legacyEntry.migrated, false);
  assert.equal(legacyEntry.size_kb, Math.round(legacyBytes / 1024));
  assert.equal(migratedEntry.migrated, true);
  assert.equal(migratedEntry.size_kb, Math.round((migratedCoreBytes + extraBytes) / 1024),
    'a migrated family\'s reported size must include its R2 extra, not just its D1 core');
  assert.ok(extraBytes > 0, 'sanity check: the fixture\'s extra half is non-trivial, so this test is actually exercising the addition');
});

await test('largest_trees falls back to core-only bytes (still flagged migrated:true) when the R2 size lookup itself fails', async () => {
  const r2 = fakeR2({ headShouldThrow: true });
  const db = fakeDB([
    {
      mode: 'all',
      pattern: /FROM family_tree ft/,
      value: () => [{ family_id: 'fam_migrated', family_name: 'Migrated Fam', bytes: 1000, extra_version: 3 }],
    },
  ]);

  const res = await onRequestGet({ env: { ...ENV_BASE, DB: db, DOCS: r2 }, data: { user: ADMIN_USER } });
  assert.equal(res.status, 200, 'a failed R2 size lookup must not crash the whole dashboard');
  const body = await res.json();
  const entry = body.largest_trees.find((t) => t.family_id === 'fam_migrated');
  assert.equal(entry.migrated, true);
  assert.equal(entry.size_kb, Math.round(1000 / 1024), 'falls back to core-only bytes when the R2 lookup itself errors');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
