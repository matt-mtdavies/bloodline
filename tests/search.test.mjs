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

// ── The reported bug: a middle name winning ties it shouldn't ──────────────
// middle_name is a short, standalone field, so a full-word query can hit it
// as an EXACT match (score 10) while that same query only ever hits a real
// "First Last" name as a starts-with match (score 6) — letting a middle
// name outrank the very person being searched for. Band offsets fix this:
// any name-field match must outrank any middle-name match, full stop.

test('a real (non-exact) first-name match still outranks an exact middle-name match', () => {
  const people = [
    person('real', { display_name: 'Mary Smith' }),        // starts-with, not exact — old score 6
    person('middle', { display_name: 'Ann Other', middle_name: 'Mary' }), // exact — old score 10
  ];
  const results = rankPeopleByName(people, 'mary');
  assert.equal(results[0].id, 'real', 'the actual Mary should lead, not the Mary-in-the-middle');
});

test('middle-name matches still surface, just below every name match', () => {
  const people = [
    person('m1', { display_name: 'Ann Other', middle_name: 'Mary' }),
    person('m2', { display_name: 'Beth Someone', middle_name: 'Mary' }),
    person('real', { display_name: 'Mary Smith' }),
  ];
  const ids = rankPeopleByName(people, 'mary').map((p) => p.id);
  assert.deepEqual(ids, ['real', 'm1', 'm2'], 'name match first, then middle-name matches alphabetically');
});

test('no query returns no results', () => {
  assert.deepEqual(rankPeopleByName([person('a')], ''), []);
  assert.deepEqual(rankPeopleByName([person('a')], '   '), []);
});

// ── Occupation + place search ───────────────────────────────────────────────

test('matches by occupation, tagged so the row can highlight it', () => {
  const people = [
    person('a', { display_name: 'Someone', occupation: 'HR Transformation Lead' }),
    person('b', { display_name: 'Other' }),
  ];
  const results = rankPeopleByName(people, 'transformation');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
  assert.equal(results[0]._matchedOccupation, true);
});

test('matches by birth place or residence, tagged so the row can highlight it', () => {
  const people = [
    person('born', { display_name: 'Someone', birth_place: 'Narre Warren, Australia' }),
    person('lives', { display_name: 'Other', residence: 'Toronto, Canada' }),
    person('neither', { display_name: 'Nobody' }),
  ];
  assert.equal(rankPeopleByName(people, 'narre warren')[0].id, 'born');
  assert.equal(rankPeopleByName(people, 'canada')[0].id, 'lives');
  assert.equal(rankPeopleByName(people, 'canada')[0]._matchedPlace, true);
});

test('a name match outranks an occupation/place match on the same query', () => {
  const people = [
    person('place', { display_name: 'Someone', birth_place: 'Marseille' }), // "mar" matches place
    person('name', { display_name: 'Mark Someone' }), // "mar" matches the actual name
  ];
  assert.equal(rankPeopleByName(people, 'mar')[0].id, 'name');
});

test('occupation is not flagged as the match reason when a name match already explains it', () => {
  const people = [person('a', { display_name: 'Mary Smith', occupation: 'Marketing Manager' })];
  const results = rankPeopleByName(people, 'mar');
  assert.equal(results[0]._matchedOccupation, false, 'the name is why this matched, not the occupation');
});

// ── Result limit ─────────────────────────────────────────────────────────────

test('no limit by default — every match is returned, not just the first 10', () => {
  const people = Array.from({ length: 15 }, (_, i) => person(`p${i}`, { display_name: `Middleton ${i}` }));
  const results = rankPeopleByName(people, 'middleton');
  assert.equal(results.length, 15);
});

test('an explicit limit is still honoured when passed', () => {
  const people = Array.from({ length: 15 }, (_, i) => person(`p${i}`, { display_name: `Middleton ${i}` }));
  const results = rankPeopleByName(people, 'middleton', 5);
  assert.equal(results.length, 5);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
