/**
 * Unit tests for migrateDocThumbsToR2 (src/data/store.js) — the Phase 0 fix
 * from docs/TREE-STORAGE.md §3/§9: `documents[].thumb` was the one field
 * that never got the same R2 treatment as `src`/photos, and being a
 * permanent per-document inline base64 preview, it's the prime suspect for
 * real tree_json bloat. Mirrors migrateDocsToR2's own contract exactly.
 * Run with: node tests/doc-thumb-migration.test.mjs
 */
import assert from 'node:assert/strict';
import { store, importFromGedcom, addDocument, migrateDocThumbsToR2 } from '../src/data/store.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function seedPerson() {
  importFromGedcom([{ id: 'p1', display_name: 'James Mercer' }], [], { merge: false });
}

const INLINE_THUMB = 'data:image/jpeg;base64,' + 'A'.repeat(200);

await test('an inline data: thumb is uploaded and replaced with the returned URL', async () => {
  seedPerson();
  const id = addDocument('p1', { title: 'Discharge Papers', mime: 'application/pdf', src: '/api/documents/xyz', thumb: INLINE_THUMB });

  const result = await migrateDocThumbsToR2(async (dataUrl) => {
    assert.equal(dataUrl, INLINE_THUMB, 'the uploader should receive the exact inline thumb');
    return '/api/documents/thumb-key';
  });

  assert.deepEqual(result, { total: 1, uploaded: 1, failed: 0 });
  const doc = store.getState().documents.find((d) => d.id === id);
  assert.equal(doc.thumb, '/api/documents/thumb-key');
});

await test('a doc with no thumb, or an already-migrated (non data:) thumb, is left alone and not counted', async () => {
  seedPerson();
  addDocument('p1', { title: 'No thumb', mime: 'application/pdf', src: '/api/documents/a', thumb: null });
  addDocument('p1', { title: 'Already migrated', mime: 'application/pdf', src: '/api/documents/b', thumb: '/api/documents/already-a-url' });

  let called = 0;
  const result = await migrateDocThumbsToR2(async () => { called++; return '/should/not/be/used'; });

  assert.deepEqual(result, { total: 0, uploaded: 0, failed: 0 });
  assert.equal(called, 0, 'the uploader must never be called when nothing needs migrating');
  const thumbs = store.getState().documents.map((d) => d.thumb);
  assert.ok(thumbs.includes(null));
  assert.ok(thumbs.includes('/api/documents/already-a-url'));
});

await test('a failed upload (uploadFn returns the same data: URL, per its documented fallback contract) counts as failed, not uploaded, and leaves the thumb inline', async () => {
  seedPerson();
  const id = addDocument('p1', { title: 'Flaky network', mime: 'application/pdf', src: '/api/documents/c', thumb: INLINE_THUMB });

  const result = await migrateDocThumbsToR2(async (dataUrl) => dataUrl); // simulates uploadDocument's own offline fallback

  assert.deepEqual(result, { total: 1, uploaded: 0, failed: 1 });
  const doc = store.getState().documents.find((d) => d.id === id);
  assert.equal(doc.thumb, INLINE_THUMB, 'a failed upload must leave the original inline thumb in place, never drop it');
});

await test('mixed success and failure across multiple documents is tallied correctly in one pass', async () => {
  seedPerson();
  const willSucceedThumb = 'data:image/jpeg;base64,' + 'B'.repeat(200);
  const willFailThumb = 'data:image/jpeg;base64,' + 'C'.repeat(200);
  const okId = addDocument('p1', { title: 'Will succeed', mime: 'application/pdf', src: '/api/documents/d', thumb: willSucceedThumb });
  const failId = addDocument('p1', { title: 'Will fail', mime: 'application/pdf', src: '/api/documents/e', thumb: willFailThumb });

  const result = await migrateDocThumbsToR2(async (dataUrl) =>
    (dataUrl === willSucceedThumb ? '/api/documents/ok-key' : dataUrl)); // uploadDocument's own contract: echo back on failure

  assert.deepEqual(result, { total: 2, uploaded: 1, failed: 1 });
  const docs = store.getState().documents;
  assert.equal(docs.find((d) => d.id === okId).thumb, '/api/documents/ok-key');
  assert.equal(docs.find((d) => d.id === failId).thumb, willFailThumb, 'the failed one keeps its original inline thumb');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
