/**
 * Regression tests for two FamilySearch import bugs found reviewing the
 * pipeline after a real report ("Someone used the import function to create
 * a tree of 600 people. They cited many duplicates created."):
 *
 * 1. fetchTree() combines an ancestry fetch and a spouses fetch that both
 *    start from the SAME logged-in person. ancestryToStore/spousesToStore
 *    each used to build their own independent idMap keyed by a fresh uid()
 *    per FS person id — so the subject person got two different internal
 *    ids, one per fetch, and was silently duplicated on every import.
 * 2. Within a single ancestry fetch, pedigree collapse (an ancestor who
 *    occupies more than one Ahnentafel position — e.g. cousins who married)
 *    means the same FS person id can appear more than once in `persons`.
 *    idMap[p.id] = uid() unconditionally overwrote the earlier id, so the
 *    final `people` array — built with a late idMap lookup AFTER the loop —
 *    ended up with duplicate-id entries, while relationships built from the
 *    now-stale, pre-overwrite ahnMap snapshot pointed at an id that no
 *    longer existed anywhere (a silently dropped/dangling relationship).
 *
 * Both are fixed by sharing one idMap (FS id -> internal id) across both
 * fetches, and never overwriting an id once assigned.
 *
 * Run with: node tests/familysearch.test.mjs
 */
import assert from 'node:assert/strict';
import { fetchTree } from '../src/lib/familysearch.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.stack || e.message}`); }
}

function fakePerson(id, ascendancyNumber, name) {
  return {
    id,
    ascendancyNumber,
    names: [{ nameForms: [{ fullText: name, parts: [] }] }],
    display: { name },
  };
}

const realFetch = globalThis.fetch;

function mockFetch(routes) {
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://x');
    const path = decodeURIComponent(u.searchParams.get('path') || '');
    const body = routes[path];
    if (!body) throw new Error(`unmocked path ${path}`);
    return { ok: true, json: async () => body };
  };
}

await test('fetchTree does not duplicate the subject person across ancestry + spouses fetches', async () => {
  mockFetch({
    '/platform/tree/current-user-person': { persons: [{ id: 'FS1' }] },
    '/platform/tree/persons/FS1/ancestry': {
      persons: [
        fakePerson('FS1', 1, 'Subject Person'),
        fakePerson('FS2', 2, 'Father Person'),
        fakePerson('FS3', 3, 'Mother Person'),
      ],
    },
    '/platform/tree/persons/FS1/spouses': {
      persons: [fakePerson('FS1', null, 'Subject Person'), fakePerson('FS4', null, 'Spouse Person')],
      relationships: [
        { type: 'http://gedcomx.org/Couple', person1: { resourceId: 'FS1' }, person2: { resourceId: 'FS4' } },
      ],
      childAndParentsRelationships: [],
    },
  });

  const result = await fetchTree('tok', 2);
  const subjects = result.people.filter((p) => p.display_name === 'Subject Person');
  assert.equal(subjects.length, 1, 'the subject should appear exactly once, not once per fetch');

  const subjectId = subjects[0].id;
  const spouseId = result.people.find((p) => p.display_name === 'Spouse Person').id;
  // Two 'partner' edges exist (the ancestry-derived parents' couple edge, and
  // the actual spouse edge) — find the one that involves the spouse.
  const coupleEdge = result.relationships.find(
    (r) => r.type === 'partner' && (r.from_person === spouseId || r.to_person === spouseId),
  );
  assert.ok(coupleEdge, 'the spouse couple edge should exist');
  assert.ok(
    coupleEdge.from_person === subjectId || coupleEdge.to_person === subjectId,
    'the spouse couple edge should reference the SAME internal id as the subject person, not a second, orphaned one',
  );

  const parentEdges = result.relationships.filter((r) => r.type === 'parent' && r.to_person === subjectId);
  assert.equal(parentEdges.length, 2, 'both ancestry parent edges should link to the single subject id');
});

await test('ancestryToStore collapses a pedigree-collapsed ancestor (same FS id at two ascendancy numbers) to one internal id', async () => {
  mockFetch({
    '/platform/tree/current-user-person': { persons: [{ id: 'FS1' }] },
    '/platform/tree/persons/FS1/ancestry': {
      persons: [
        fakePerson('FS1', 1, 'Subject Person'),
        fakePerson('FS2', 2, 'Parent A'),
        fakePerson('FS3', 3, 'Parent B'),
        // A shared ancestor occupying two Ahnentafel positions at once.
        fakePerson('FSgp', 6, 'Shared Grandparent'),
        fakePerson('FSgp', 7, 'Shared Grandparent'),
      ],
    },
    '/platform/tree/persons/FS1/spouses': { persons: [], relationships: [], childAndParentsRelationships: [] },
  });

  const result = await fetchTree('tok', 3);
  const gps = result.people.filter((p) => p.display_name === 'Shared Grandparent');
  assert.equal(gps.length, 1, 'the pedigree-collapsed ancestor should appear exactly once, not as a duplicate-id entry');

  const gpId = gps[0].id;
  const parentBId = result.people.find((p) => p.display_name === 'Parent B').id;
  // Both the ascendancy-6 and ascendancy-7 edges resolve to the identical
  // (from, to, type) triple once they share one internal id — fetchTree's
  // own top-level dedup then collapses them to one edge. Under the old bug
  // they'd have had two DIFFERENT from_person ids (one stale/dangling), so
  // this would never have deduped and the stale one would point at nothing.
  const edgesFromGp = result.relationships.filter(
    (r) => r.type === 'parent' && r.from_person === gpId && r.to_person === parentBId,
  );
  assert.equal(
    edgesFromGp.length, 1,
    'the ascendancy-6 and ascendancy-7 parent edges should reference the SAME internal id and collapse to one, non-dangling edge',
  );
  const danglingEdges = result.relationships.filter(
    (r) => r.type === 'parent' && r.to_person === parentBId && r.from_person !== gpId,
  );
  assert.equal(danglingEdges.length, 0, 'there should be no stale edge pointing at a different, dropped internal id');
});

globalThis.fetch = realFetch;

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
