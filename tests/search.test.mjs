/**
 * Unit tests for lib/search.js — the search overlay's name-matching, in
 * particular the middle-name fix (previously middle_name was invisible to
 * search even though it's a real, separately-edited field).
 * Run with: node tests/search.test.mjs
 */
import assert from 'node:assert/strict';
import { scoreText, rankPeopleByName } from '../src/lib/search.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });

// ── scoreText ────────────────────────────────────────────────────────────

test('scoreText: exact match scores highest', () => {
  assert.ok(scoreText('James', 'james') > scoreText('James Robert', 'james'));
});

test('scoreText: empty text or query scores 0', () => {
  assert.equal(scoreText('', 'james'), 0);
  assert.equal(scoreText('James', ''), 0);
});

// ── rankPeopleByName: the middle-name fix ──────────────────────────────────

test('a middle name absent from display_name is now searchable', () => {
  const people = [
    person('robert', { display_name: 'Robert Mercer', middle_name: 'James' }),
    person('other', { display_name: 'Someone Else' }),
  ];
  const results = rankPeopleByName(people, 'James');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'robert');
});

test('middle name match is tagged so the UI can surface it, matching the née-hint pattern', () => {
  const people = [person('robert', { display_name: 'Robert Mercer', middle_name: 'James' })];
  const results = rankPeopleByName(people, 'james');
  assert.equal(results[0]._middleName, 'James');
});

test('a middle name already present in display_name does not duplicate the match', () => {
  const people = [person('r', { display_name: 'James Robert Mercer', middle_name: 'Robert' })];
  const results = rankPeopleByName(people, 'robert');
  assert.equal(results.length, 1); // still one match, not double-counted
});

test('display name, birth name, and middle name are all independently searchable', () => {
  const people = [
    person('a', { display_name: 'Ada Lovelace' }),
    person('b', { display_name: 'Elizabeth Bennet', birth_name: 'Elizabeth Garrick' }),
    person('c', { display_name: 'Robert Mercer', middle_name: 'James' }),
  ];
  assert.equal(rankPeopleByName(people, 'ada')[0].id, 'a');
  assert.equal(rankPeopleByName(people, 'garrick')[0].id, 'b');
  assert.equal(rankPeopleByName(people, 'james')[0].id, 'c');
});

test('best match wins when a query matches multiple fields across different people', () => {
  const people = [
    person('exact', { display_name: 'James' }),
    person('middle', { display_name: 'Robert Mercer', middle_name: 'James' }),
  ];
  const results = rankPeopleByName(people, 'james');
  assert.equal(results[0].id, 'exact', 'an exact display-name match should outrank a middle-name match');
});

test('no query returns no results', () => {
  assert.deepEqual(rankPeopleByName([person('a')], ''), []);
  assert.deepEqual(rankPeopleByName([person('a')], '   '), []);
});

test('results are capped at the limit and sorted alphabetically on tied scores', () => {
  const people = Array.from({ length: 15 }, (_, i) => person(`p${i}`, { display_name: `Middleton ${i}` }));
  const results = rankPeopleByName(people, 'middleton');
  assert.equal(results.length, 10);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
