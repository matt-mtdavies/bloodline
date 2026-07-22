/**
 * Regression test for the nameKey suffix bug found reviewing the import
 * pipeline: nameKey() took the LAST whitespace token as the surname, so
 * "John Smith Jr." keyed as first="john" last="jr." — which never grouped
 * with a duplicate stub "John Smith" (last="smith"), silently missing a
 * real duplicate pair. Generational suffixes (Jr./Sr./II/III/IV/V) are now
 * stripped before the surname is taken.
 *
 * Run with: node tests/duplicates.test.mjs
 */
import assert from 'node:assert/strict';
import { findDuplicatePairs, dedupeMergeImport } from '../src/lib/duplicates.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('a "Jr." suffix no longer prevents matching a same-named stub', () => {
  const people = [
    { id: 'a', display_name: 'John Smith Jr.' },
    { id: 'b', display_name: 'John Smith' }, // a thin stub — no birth_date/photo/bio/events
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1, 'the suffix should not block the stub-record duplicate signal');
  assert.deepEqual([pairs[0].aId, pairs[0].bId].sort(), ['a', 'b']);
});

test('"II"/"III" suffixes are stripped the same way', () => {
  const people = [
    { id: 'a', display_name: 'Robert Doyle III' },
    { id: 'b', display_name: 'Robert Doyle' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1);
});

test('two genuinely different people who happen to share a first+last name are still not falsely matched (no corroboration)', () => {
  const people = [
    { id: 'a', display_name: 'John Smith', birth_date: '1950', bio: 'A long biography.' },
    { id: 'b', display_name: 'John Smith', birth_date: '1990', bio: 'A different long biography.' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 0, 'conflicting known birth years should still rule the pair out');
});

test('a bare two-word name is unaffected by the suffix-stripping change', () => {
  const people = [
    { id: 'a', display_name: 'Jane Doe' },
    { id: 'b', display_name: 'Jane Doe' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1, 'the ordinary two-word case must still match exactly as before');
});

// ── dedupeMergeImport: re-importing shouldn't double the tree ───────────────

test('re-importing the same people collapses them (no doubling), remapping edges', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12' },
    { id: 'e2', display_name: 'Mary Smith', birth_date: '1952' },
    { id: 'e3', display_name: 'Anne Smith', birth_date: '1978' },
  ];
  const existingR = [
    { id: 'er1', type: 'partner', from_person: 'e1', to_person: 'e2' },
    { id: 'er2', type: 'parent', from_person: 'e1', to_person: 'e3' },
  ];
  // The same three people + same edges, freshly parsed with new ids.
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950-03-12' },
    { id: 'n2', display_name: 'Mary Smith', birth_date: '1952' },
    { id: 'n3', display_name: 'Anne Smith', birth_date: '1978' },
  ];
  const newR = [
    { id: 'nr1', type: 'partner', from_person: 'n1', to_person: 'n2' },
    { id: 'nr2', type: 'parent', from_person: 'n1', to_person: 'n3' },
  ];
  const out = dedupeMergeImport(existingP, existingR, newP, newR);
  assert.equal(out.people.length, 0, 'every re-added person is collapsed');
  assert.equal(out.skipped, 3);
  assert.equal(out.relationships.length, 0, 'edges that map onto existing ones are dropped too');
});

test('genuinely new people (and their edges) still import', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950' },     // dup → collapsed
    { id: 'n2', display_name: 'Baby Smith', birth_date: '2020' },     // new → kept
  ];
  const newR = [{ id: 'nr1', type: 'parent', from_person: 'n1', to_person: 'n2' }];
  const out = dedupeMergeImport(existingP, [], newP, newR);
  assert.deepEqual(out.people.map((p) => p.id), ['n2']);
  assert.equal(out.relationships.length, 1, 'the new parent edge survives...');
  assert.equal(out.relationships[0].from_person, 'e1', '...remapped onto the existing John');
  assert.equal(out.relationships[0].to_person, 'n2');
});

test('an ambiguous match (two existing people, same name+year) is NOT auto-merged', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950' },
    { id: 'e2', display_name: 'John Smith', birth_date: '1950' }, // already two (cousins?)
  ];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1'], 'ambiguity falls through to the review sheet, not a silent merge');
});

test('a full-date conflict (same name+year, different day) is kept separate', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12' }];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950-11-30' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1'], 'conflicting exact dates → different people');
});

test('a dateless record is never auto-merged (too weak — left for review)', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith' }];
  const newP = [{ id: 'n1', display_name: 'John Smith' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1']);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
