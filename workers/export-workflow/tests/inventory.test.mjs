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

test('a malformed percent-encoded /api/photos/ key classifies as unsupported, never throws', () => {
  assert.doesNotThrow(() => classifyReference('/api/photos/broken%.jpg'));
  const c = classifyReference('/api/photos/broken%.jpg');
  assert.equal(c.kind, 'unsupported');
  assert.match(c.reason, /photo key/);
});

test('a malformed percent-encoded /api/documents/ key classifies as unsupported, never throws', () => {
  assert.doesNotThrow(() => classifyReference('/api/documents/broken%zz.pdf'));
  const c = classifyReference('/api/documents/broken%zz.pdf');
  assert.equal(c.kind, 'unsupported');
  assert.match(c.reason, /document key/);
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

// Every test below now supplies BOTH injected callbacks per the current
// contract (listPrefix returns lightweight {key,byteLength,etag} —
// deliberately never a body — and getBody(key) is called by
// buildKeepsakeInventory itself, at most once per person, only for
// whichever key resolves to the determined latest edition). A no-op
// getBody that always returns null is used wherever a test doesn't care
// about narrative content at all.
function getBodyFromMap(bodiesByKey) {
  return async (key) => (key in bodiesByKey ? bodiesByKey[key] : null);
}

await atest('buildKeepsakeInventory lists only the scoped prefix per person, never the whole bucket', async () => {
  const requestedPrefixes = [];
  const tree = { people: [{ id: 'p1' }, { id: 'p2' }] };
  await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async (prefix) => { requestedPrefixes.push(prefix); return []; },
    getBody: async () => null,
  });
  assert.deepEqual(requestedPrefixes, ['keepsake/fam_1/p1/', 'keepsake/fam_1/p2/']);
});

await atest('a person with no Keepsake at all contributes no entries and no warning', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', { listPrefix: async () => [], getBody: async () => null });
  assert.deepEqual(entries, []);
});

await atest('latest.json byte-identical to a hashed edition is recorded as an alias, not a duplicate file', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries, aliases } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc123hash.json', byteLength: 500, etag: '"same-etag"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"same-etag"' },
    ],
    getBody: async () => null,
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
    getBody: async () => null,
  });
  assert.equal(entries.length, 2);
  assert.equal(aliases.length, 0);
});

await atest('the alias-target (current) edition is flagged isLatestEdition; older hashed editions are not', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/oldhash.json', byteLength: 400, etag: '"old-etag"' },
      { key: 'keepsake/fam_1/p1/currenthash.json', byteLength: 500, etag: '"cur-etag"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"cur-etag"' },
    ],
    getBody: async () => null,
  });
  const current = entries.find((e) => e.id === 'p1:currenthash');
  const old = entries.find((e) => e.id === 'p1:oldhash');
  assert.equal(current.isLatestEdition, true);
  assert.ok(!old.isLatestEdition);
});

await atest('a standalone latest.json (no matching hashed copy) is itself flagged isLatestEdition', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [{ key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"new-etag"' }],
    getBody: async () => null,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].isLatestEdition, true);
});

await atest('getBody is called AT MOST ONCE per person, for the determined latest edition only — the PR #9 4th-review finding that every hashed edition\'s body used to be fetched and parsed regardless of whether anything ever read it', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const calls = [];
  const editionCount = 500; // "thousands of retained editions" scaled down for a fast unit test — the mechanism doesn't care about the exact count
  const objects = Array.from({ length: editionCount }, (_, i) => ({ key: `keepsake/fam_1/p1/hash${i}.json`, byteLength: 500, etag: `"etag-${i}"` }));
  objects.push({ key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"etag-499"' }); // matches the LAST hashed edition
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => objects,
    getBody: async (key) => { calls.push(key); return JSON.stringify({ narrative: null }); },
  });
  assert.equal(entries.length, editionCount, 'every edition still becomes a real archived entry');
  assert.equal(calls.length, 1, 'exactly one body must ever be fetched, no matter how many total editions exist');
  assert.equal(calls[0], 'keepsake/fam_1/p1/hash499.json', 'the ONE fetched body must be the determined latest edition, not an arbitrary one');
});

await atest('a person with NO latest.json at all never triggers a single getBody call — nothing is ever flagged isLatestEdition to fetch a body for', async () => {
  const tree = { people: [{ id: 'p1' }] };
  let calls = 0;
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/hash1.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/hash2.json', byteLength: 500, etag: '"e2"' },
    ],
    getBody: async () => { calls += 1; return '{}'; },
  });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => !e.isLatestEdition));
  assert.equal(calls, 0, 'no getBody call should ever happen when nothing is determined to be the latest edition');
});

await atest('the determined latest edition\'s body is fetched via getBody and parsed into its edition field', async () => {
  const editionBody = { personId: 'p1', hash: 'abc', editionNumber: 1, narrative: { epithet: 'The Storyteller', origins: [], chapters: [], legacy: [] } };
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': JSON.stringify(editionBody) }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.isLatestEdition, true);
  assert.deepEqual(entry.edition, editionBody);
});

await atest('a malformed body degrades to no narrative rather than throwing', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': '{not valid json' }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition, null);
});

// A structurally valid JSON body whose `narrative` doesn't match the real
// shape (functions/api/keepsake.js's own validateNarrative) must not reach
// the viewer as-is — its .map() calls over origins/chapters/legacy/
// paragraphs would throw on a non-array field (review finding). Each
// fixture below gives its single hashed edition a matching latest.json so
// it becomes the determined latest edition and its body is actually
// fetched/parsed.
await atest('a narrative with non-array origins normalizes to no narrative, without dropping the rest of the edition', async () => {
  const body = JSON.stringify({ personId: 'p1', hash: 'abc', editionNumber: 3, narrative: { epithet: 'Test', origins: 'not an array', chapters: [], legacy: [] } });
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': body }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition.narrative, null);
  assert.equal(entry.edition.hash, 'abc');
  assert.equal(entry.edition.editionNumber, 3);
});

await atest('a narrative with non-array chapters normalizes to no narrative', async () => {
  const body = JSON.stringify({ narrative: { epithet: 'Test', origins: [], chapters: 'nope', legacy: [] } });
  const { entries } = await buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': body }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition.narrative, null);
});

await atest('a chapter missing a paragraphs array normalizes to no narrative', async () => {
  const body = JSON.stringify({ narrative: { epithet: 'Test', origins: [], chapters: [{ title: 'Ch1', years: '2000-2001', paragraphs: 'not an array' }], legacy: [] } });
  const { entries } = await buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': body }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition.narrative, null);
});

await atest('a narrative missing an epithet normalizes to no narrative', async () => {
  const body = JSON.stringify({ narrative: { origins: [], chapters: [], legacy: [] } });
  const { entries } = await buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': body }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition.narrative, null);
});

await atest('a well-formed narrative still passes through unchanged', async () => {
  const goodNarrative = { epithet: 'The Storyteller', origins: ['Cardiff'], chapters: [{ title: 'Ch1', years: '2000-2010', paragraphs: ['Hello.'] }], legacy: ['Remembered.'] };
  const body = JSON.stringify({ narrative: goodNarrative });
  const { entries } = await buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: getBodyFromMap({ 'keepsake/fam_1/p1/abc.json': body }),
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.deepEqual(entry.edition.narrative, goodNarrative);
});

await atest('getBody returning null (e.g. the object vanished between listing and fetch) leaves edition null rather than throwing', async () => {
  const tree = { people: [{ id: 'p1' }] };
  const { entries } = await buildKeepsakeInventory(tree, 'fam_1', {
    listPrefix: async () => [
      { key: 'keepsake/fam_1/p1/abc.json', byteLength: 500, etag: '"e1"' },
      { key: 'keepsake/fam_1/p1/latest.json', byteLength: 500, etag: '"e1"' },
    ],
    getBody: async () => null,
  });
  const entry = entries.find((e) => e.id === 'p1:abc');
  assert.equal(entry.edition, null);
});

await atest('buildKeepsakeInventory requires a listPrefix callback', async () => {
  await assert.rejects(() => buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', { getBody: async () => null }));
});

await atest('buildKeepsakeInventory requires a getBody callback', async () => {
  await assert.rejects(() => buildKeepsakeInventory({ people: [{ id: 'p1' }] }, 'fam_1', { listPrefix: async () => [] }));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
