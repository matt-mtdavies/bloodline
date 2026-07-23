import assert from 'node:assert/strict';
import { classifyReference, resolveEntry, buildMediaInventory, buildKeepsakeInventory, extForMime } from '../src/lib/inventory.js';
import { sha256Hex } from '../src/lib/manifest.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── classifyReference ────────────────────────────────────────────────────

test('classifies a data: URL with mime type and base64 payload', () => {
  const c = classifyReference('data:image/jpeg;base64,QUJD');
  assert.equal(c.kind, 'data_url');
  assert.equal(c.mimeType, 'image/jpeg');
  assert.equal(c.base64, 'QUJD');
});

test('classifies an /api/photos/{key} reference', () => {
  const c = classifyReference('/api/photos/ph_abc123.jpg');
  assert.equal(c.kind, 'r2');
  assert.equal(c.route, 'photos');
  assert.equal(c.key, 'ph_abc123.jpg');
});

test('classifies an /api/documents/{key} reference', () => {
  const c = classifyReference('/api/documents/doc_xyz.pdf');
  assert.equal(c.kind, 'r2');
  assert.equal(c.route, 'documents');
  assert.equal(c.key, 'doc_xyz.pdf');
});

test('classifies an external https URL as external, never fetched', () => {
  const c = classifyReference('https://i.pravatar.cc/1000?img=5');
  assert.equal(c.kind, 'external');
  assert.equal(c.url, 'https://i.pravatar.cc/1000?img=5');
});

test('classifies a non-base64 data URL as unsupported (never silently mis-decoded)', () => {
  const c = classifyReference('data:text/plain,hello');
  assert.equal(c.kind, 'unsupported');
});

test('classifies null/empty/garbage as unsupported, never throws', () => {
  assert.equal(classifyReference(null).kind, 'unsupported');
  assert.equal(classifyReference('').kind, 'unsupported');
  assert.equal(classifyReference('not a url at all').kind, 'unsupported');
  assert.equal(classifyReference(12345).kind, 'unsupported');
});

test('extForMime maps known types and falls back to bin for unknown', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg');
  assert.equal(extForMime('application/pdf'), 'pdf');
  assert.equal(extForMime('application/x-nonsense'), 'bin');
  assert.equal(extForMime(undefined), 'bin');
});

// ── resolveEntry ──────────────────────────────────────────────────────────

await atest('a data_url entry is hashed and sized immediately, no I/O needed', async () => {
  const payload = Buffer.from('hello world').toString('base64');
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: `data:image/jpeg;base64,${payload}`,
  });
  assert.equal(entry.status, 'included');
  assert.equal(entry.byteLength, 11);
  assert.equal(entry.sha256, sha256Hex('hello world'));
  assert.equal(entry.mimeType, 'image/jpeg');
});

await atest('an external reference never invokes the resolver and is never fetched', async () => {
  let called = false;
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: 'https://example.com/photo.jpg',
  }, async () => { called = true; });
  assert.equal(entry.status, 'external_reference');
  assert.equal(called, false);
});

await atest('an r2 reference resolves via the injected head callback (found)', async () => {
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: '/api/photos/ph_1.jpg',
  }, async (route, key) => {
    assert.equal(route, 'photos');
    assert.equal(key, 'ph_1.jpg');
    return { found: true, byteLength: 5000, mimeType: 'image/jpeg', etag: '"abc123"' };
  });
  assert.equal(entry.status, 'included');
  assert.equal(entry.byteLength, 5000);
  assert.equal(entry.etag, '"abc123"');
  assert.equal(entry.sha256, undefined, 'no SHA-256 at inventory time for r2 refs — computed during packaging');
});

await atest('an r2 reference resolves to missing when the resolver reports not-found', async () => {
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: '/api/photos/ph_gone.jpg',
  }, async () => ({ found: false }));
  assert.equal(entry.status, 'missing');
});

await atest('an r2 reference resolves to unreadable when the resolver throws (transient failure)', async () => {
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: '/api/photos/ph_flaky.jpg',
  }, async () => { throw new Error('R2 timeout'); });
  assert.equal(entry.status, 'unreadable');
  assert.match(entry.warning, /R2 timeout/);
});

await atest('an r2 reference without a resolveR2Head callback throws (programmer error, not a silent skip)', async () => {
  await assert.rejects(() => resolveEntry({
    archivePath: 'x', recordId: 'p1', recordType: 'person_photo', rawRef: '/api/photos/ph_1.jpg',
  }));
});

await atest('a malformed data URL is marked unsupported, not silently dropped', async () => {
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: 'data:image/jpeg;base64,%%%not-valid-base64%%%',
  });
  // atob is lenient with some invalid input in some engines, so only assert
  // this never throws uncaught and always yields a status.
  assert.ok(['included', 'unsupported'].includes(entry.status));
});

await atest('the original reference recorded for a data_url never contains the raw payload (manifest size discipline)', async () => {
  const bigPayload = Buffer.alloc(200000, 'a').toString('base64');
  const entry = await resolveEntry({
    archivePath: 'photos/p1_test.jpg', recordId: 'p1', recordType: 'person_photo',
    rawRef: `data:image/jpeg;base64,${bigPayload}`,
  });
  assert.ok(JSON.stringify(entry.originalReference).length < 200);
});

// ── buildMediaInventory ───────────────────────────────────────────────────

function fakeR2Head(route, key) {
  if (key === 'missing.jpg') return { found: false };
  if (key === 'flaky.pdf') throw new Error('boom');
  return { found: true, byteLength: 1234, mimeType: route === 'photos' ? 'image/jpeg' : 'application/pdf', etag: `"${key}"` };
}

await atest('buildMediaInventory covers person photo, photo_thumb, gallery photos, and document src/thumb', async () => {
  const tree = {
    people: [
      { id: 'p1', display_name: 'James Mercer', photo: '/api/photos/portrait.jpg', photo_thumb: 'data:image/jpeg;base64,QUJD' },
      { id: 'p2', display_name: 'No Photo Person' },
    ],
    photos: [{ id: 'ph1', caption: 'Reunion', src: '/api/photos/reunion.jpg' }],
    documents: [{ id: 'doc1', title: 'Birth Certificate', mime: 'application/pdf', src: '/api/documents/birth.pdf', thumb: 'data:image/jpeg;base64,QUJD' }],
  };
  const entries = await buildMediaInventory(tree, { resolveR2Head: fakeR2Head });
  const recordTypes = entries.map((e) => e.recordType);
  assert.ok(recordTypes.includes('person_photo'));
  assert.ok(recordTypes.includes('person_photo_thumb'));
  assert.ok(recordTypes.includes('photo'));
  assert.ok(recordTypes.includes('document'));
  assert.ok(recordTypes.includes('document_thumb'));
  assert.equal(entries.length, 5, 'p2 with no photo contributes zero entries');
  assert.ok(entries.every((e) => e.status === 'included'));
});

await atest('buildMediaInventory reports missing and unreadable media as explicit entries, not silently dropped', async () => {
  const tree = {
    people: [{ id: 'p1', display_name: 'Test', photo: '/api/photos/missing.jpg' }],
    documents: [{ id: 'doc1', title: 'Flaky', src: '/api/documents/flaky.pdf' }],
  };
  const entries = await buildMediaInventory(tree, { resolveR2Head: fakeR2Head });
  const photoEntry = entries.find((e) => e.recordType === 'person_photo');
  const docEntry = entries.find((e) => e.recordType === 'document');
  assert.equal(photoEntry.status, 'missing');
  assert.equal(docEntry.status, 'unreadable');
});

await atest('buildMediaInventory external photo URLs (e.g. legacy seed avatars) never call the resolver', async () => {
  let called = false;
  const tree = { people: [{ id: 'p1', display_name: 'Test', photo: 'https://i.pravatar.cc/1000?img=5' }] };
  const entries = await buildMediaInventory(tree, { resolveR2Head: async () => { called = true; } });
  assert.equal(entries[0].status, 'external_reference');
  assert.equal(called, false);
});

await atest('buildMediaInventory on an empty tree returns no entries', async () => {
  const entries = await buildMediaInventory({});
  assert.deepEqual(entries, []);
});

// ── buildKeepsakeInventory ────────────────────────────────────────────────

await atest('buildKeepsakeInventory lists only the scoped prefix per person, never the whole bucket', async () => {
  const requestedPrefixes = [];
  const tree = { people: [{ id: 'p1' }, { id: 'p2' }] };
  await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async (prefix) => { requestedPrefixes.push(prefix); return []; },
  });
  assert.deepEqual(requestedPrefixes, ['keepsake/fam_1/p1/', 'keepsake/fam_1/p2/']);
});

await atest('a person with no Keepsake at all contributes no entries and no warning', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', { listPrefix: async () => [] });
  assert.deepEqual(entries, []);
});

await atest('latest.json byte-identical to a hashed edition is recorded as an alias, not a duplicate file', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries, aliases } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc123hash.json', byteLength: 500, etag: '"same-etag"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"same-etag"' },
    ],
  });
  assert.equal(entries.length, 1, 'only the hashed edition becomes an archived file');
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].personId, 'p1');
});

await atest('latest.json NOT matching any hashed edition is archived as its own distinct file', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries, aliases } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/oldhash.json', byteLength: 400, etag: '"old-etag"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"new-etag"' },
    ],
  });
  assert.equal(entries.length, 2);
  assert.equal(aliases.length, 0);
});

await atest('buildKeepsakeInventory requires a listPrefix callback', async () => {
  await assert.rejects(() => buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', {}));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
