/**
 * Unit tests for lib/profile.js — completeness + life events.
 * Run with: node tests/profile.test.mjs
 */
import assert from 'node:assert/strict';
import { lifeEvents, isDuplicateLifeEvent } from '../src/lib/profile.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('lifeEvents surfaces cause_of_death as the "Passed away" event detail', () => {
  const person = {
    birth_date: '1930-01-01',
    is_deceased: true,
    death_date: '1990-06-01',
    cause_of_death: 'Heart disease',
  };
  const events = lifeEvents(person);
  const passedAway = events.find((e) => e.title === 'Passed away');
  assert.ok(passedAway, 'expected a Passed away event');
  assert.equal(passedAway.detail, 'Heart disease');
});

test('lifeEvents leaves the "Passed away" detail null when no cause is recorded', () => {
  const person = { birth_date: '1930-01-01', is_deceased: true, death_date: '1990-06-01' };
  const events = lifeEvents(person);
  const passedAway = events.find((e) => e.title === 'Passed away');
  assert.ok(passedAway);
  assert.equal(passedAway.detail, null);
});

test('lifeEvents never adds a "Passed away" event for someone still living', () => {
  const person = { birth_date: '1930-01-01', is_deceased: false, cause_of_death: 'should be ignored' };
  const events = lifeEvents(person);
  assert.equal(events.find((e) => e.title === 'Passed away'), undefined);
});

test('lifeEvents sorts Born / custom events / Passed away chronologically', () => {
  const person = {
    birth_date: '1930-01-01',
    is_deceased: true,
    death_date: '1990-06-01',
    cause_of_death: 'Old age',
    events: [{ year: 1955, title: 'Married' }],
  };
  const events = lifeEvents(person);
  assert.deepEqual(events.map((e) => e.title), ['Born', 'Married', 'Passed away']);
});

test('isDuplicateLifeEvent flags a "Born" fact matching the derived birth year', () => {
  const person = { birth_date: '1924-11-27', birth_place: null };
  assert.equal(isDuplicateLifeEvent(person, { year: '1924', title: 'Born' }), true);
});

test('isDuplicateLifeEvent does not flag a "Born" fact for a different year', () => {
  const person = { birth_date: '1924-11-27' };
  assert.equal(isDuplicateLifeEvent(person, { year: '1925', title: 'Born' }), false);
});

test('isDuplicateLifeEvent flags "Died"/"Passed away" facts matching the derived death year', () => {
  const person = { is_deceased: true, death_date: '2007-03-31' };
  assert.equal(isDuplicateLifeEvent(person, { year: '2007', title: 'Died' }), true);
  assert.equal(isDuplicateLifeEvent(person, { year: '2007', title: 'Passed away' }), true);
});

test('isDuplicateLifeEvent flags an exact title+year match against a stored event', () => {
  const person = { events: [{ year: 1945, title: 'Enlisted' }] };
  assert.equal(isDuplicateLifeEvent(person, { year: '1945', title: 'Enlisted' }), true);
});

test('isDuplicateLifeEvent flags near-identical titles in the same year (substring match)', () => {
  const person = { events: [{ year: 1945, title: 'Enlisted' }] };
  assert.equal(isDuplicateLifeEvent(person, { year: '1945', title: 'Enlisted/Began Service' }), true);
});

test('isDuplicateLifeEvent never flags genuinely distinct same-year events', () => {
  const person = {
    events: [
      { year: 1945, title: 'Placed dangerously ill' },
      { year: 1945, title: 'Admitted for appendicitis' },
    ],
  };
  assert.equal(isDuplicateLifeEvent(person, { year: '1945', title: 'Surgery - Appendicectomy' }), false);
  assert.equal(isDuplicateLifeEvent(person, { year: '1945', title: 'Removed from dangerously ill list' }), false);
});

test('isDuplicateLifeEvent is case- and punctuation-insensitive', () => {
  const person = { events: [{ year: 1913, title: 'Parents Married' }] };
  assert.equal(isDuplicateLifeEvent(person, { year: '1913', title: 'parents married!' }), true);
});

test('isDuplicateLifeEvent returns false for a fact with no year', () => {
  const person = { birth_date: '1924-11-27' };
  assert.equal(isDuplicateLifeEvent(person, { year: null, title: 'Born' }), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
