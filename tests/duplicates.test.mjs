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
import { findDuplicatePairs } from '../src/lib/duplicates.js';

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

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
