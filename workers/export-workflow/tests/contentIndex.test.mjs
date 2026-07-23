import assert from 'node:assert/strict';
import { buildContentIndex, toContentIndexJSON, toTreeDataJs, TREE_DATA_GLOBAL_NAME } from '../src/lib/contentIndex.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const tree = {
  people: [
    { id: 'p1', display_name: 'James Mercer', birth_date: '1985-03-01', occupation: 'Teacher', events: [{ year: 2010, title: 'Graduated' }] },
    { id: 'p2', display_name: 'Megan Mercer' },
    { id: 'p3', display_name: 'Oliver Mercer' },
  ],
  relationships: [
    { id: 'r1', from_person: 'p1', to_person: 'p3', type: 'parent' },
    { id: 'r2', from_person: 'p2', to_person: 'p3', type: 'parent' },
    { id: 'r3', from_person: 'p1', to_person: 'p2', type: 'partner' },
  ],
  documents: [{ id: 'doc1', title: 'Birth Certificate', person_id: 'p1' }],
  memories: [{ id: 'mem1', person_id: 'p1', text: 'A lovely memory' }, { id: 'mem2', person_id: 'p2', text: 'Another one' }],
};

const mediaEntries = [
  { path: 'photos/p1_James.jpg', id: 'p1', ownerId: 'p1', recordType: 'person_photo', status: 'included' },
  { path: 'documents/doc1_Birth.pdf', id: 'doc1', ownerId: 'p1', recordType: 'document', status: 'missing' },
  { path: 'photos/ph2_ext.jpg', id: 'ph2', ownerId: 'p2', recordType: 'photo', status: 'external_reference' },
];

test('buildContentIndex requires a sourceChecksum', () => {
  assert.throws(() => buildContentIndex(tree, mediaEntries, {}));
});

test('people index carries the full person record plus a normalized search key', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.equal(idx.people.p1.display_name, 'James Mercer');
  assert.equal(idx.people.p1.birth_date, '1985-03-01');
  assert.equal(idx.people.p1.occupation, 'Teacher');
  assert.equal(idx.people.p1.searchKey, 'james mercer');
});

test('people index carries each person\'s life events (already embedded on the person record)', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.deepEqual(idx.people.p1.events, [{ year: 2010, title: 'Graduated' }]);
});

test('people index joins memories by person_id, scoped to the right person', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.equal(idx.people.p1.memories.length, 1);
  assert.equal(idx.people.p1.memories[0].text, 'A lovely memory');
  assert.equal(idx.people.p2.memories.length, 1);
  assert.equal(idx.people.p3.memories.length, 0);
});

test('documents index carries the full document record plus a normalized search key', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.equal(idx.documents.doc1.title, 'Birth Certificate');
  assert.equal(idx.documents.doc1.searchKey, 'birth certificate');
});

test('relationship adjacency correctly derives parents/children/partners', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.deepEqual(idx.relationshipAdjacency.p3.parents.sort(), ['p1', 'p2']);
  assert.deepEqual(idx.relationshipAdjacency.p1.children, ['p3']);
  assert.deepEqual(idx.relationshipAdjacency.p1.partners, ['p2']);
  assert.deepEqual(idx.relationshipAdjacency.p2.partners, ['p1']);
});

test('media index surfaces owner IDs and warning status for missing/external entries', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  const doc = idx.media.find((m) => m.fileId === 'doc1');
  assert.equal(doc.ownerId, 'p1');
  assert.equal(doc.warning, 'missing');
  const included = idx.media.find((m) => m.fileId === 'p1');
  assert.equal(included.warning, null);
  const external = idx.media.find((m) => m.fileId === 'ph2');
  assert.equal(external.warning, 'external_reference');
});

test('counts reflect the actual people/documents/media totals', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'abc' });
  assert.equal(idx.counts.people, 3);
  assert.equal(idx.counts.documents, 1);
  assert.equal(idx.counts.media, 3);
});

test('content-index.json and tree-data.js decode to identical data (§3.5 requirement)', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'checksum123' });
  const json = toContentIndexJSON(idx);
  const js = toTreeDataJs(idx);

  const decodedJson = JSON.parse(json);

  // Execute the tree-data.js form in a sandboxed `window` the way
  // START-HERE.html's own <script src="tree-data.js"> would, then read
  // the assigned global back out — proving the two files are byte-for-
  // byte equivalent once decoded, not just "look similar".
  const sandbox = { window: {} };
  const fn = new Function('window', js); // eslint-disable-line no-new-func
  fn(sandbox.window);
  const decodedJs = sandbox.window[TREE_DATA_GLOBAL_NAME];

  assert.deepEqual(decodedJs, decodedJson);
});

test('both output forms carry the same viewerIndexVersion, counts, and sourceChecksum', () => {
  const idx = buildContentIndex(tree, mediaEntries, { sourceChecksum: 'checksum123' });
  const decodedJson = JSON.parse(toContentIndexJSON(idx));
  const sandbox = {};
  new Function('window', toTreeDataJs(idx))(sandbox); // eslint-disable-line no-new-func
  const decodedJs = sandbox[TREE_DATA_GLOBAL_NAME];
  for (const field of ['viewerIndexVersion', 'counts', 'sourceChecksum']) {
    assert.deepEqual(decodedJson[field], decodedJs[field]);
  }
});

test('an empty tree produces a valid, empty-but-well-formed index', () => {
  const idx = buildContentIndex({}, [], { sourceChecksum: 'x' });
  assert.deepEqual(idx.people, {});
  assert.deepEqual(idx.documents, {});
  assert.deepEqual(idx.media, []);
  assert.equal(idx.counts.people, 0);
});

test('a relationship referencing an unknown person ID does not throw', () => {
  const brokenTree = { people: [{ id: 'p1', display_name: 'Solo' }], relationships: [{ id: 'r1', from_person: 'p1', to_person: 'ghost', type: 'parent' }] };
  assert.doesNotThrow(() => buildContentIndex(brokenTree, [], { sourceChecksum: 'x' }));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
