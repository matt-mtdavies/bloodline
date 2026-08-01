/**
 * Unit tests for lib/profile.js — completeness + life events.
 * Run with: node tests/profile.test.mjs
 */
import assert from 'node:assert/strict';
import { lifeEvents, isDuplicateLifeEvent, hasEventMentioning, buildRestingPlacePatch } from '../src/lib/profile.js';

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

test('hasEventMentioning matches a same-year event phrased completely differently', () => {
  const person = { events: [{ year: 2012, title: 'Our son arrived', detail: 'Born in Cardiff, a Tuesday morning.' }] };
  assert.equal(hasEventMentioning(person, 2012, 'Oliver Mercer'), false); // "Oliver" never appears
  const person2 = { events: [{ year: 2012, title: 'Birth of Oliver', detail: 'At Cardiff.' }] };
  assert.equal(hasEventMentioning(person2, 2012, 'Oliver Mercer'), true);
});

test('hasEventMentioning matches the name in the detail, not just the title', () => {
  const person = { events: [{ year: 2012, title: 'A big year', detail: 'Welcomed our son Oliver.' }] };
  assert.equal(hasEventMentioning(person, 2012, 'Oliver'), true);
});

test('hasEventMentioning is case-insensitive and ignores punctuation', () => {
  const person = { events: [{ year: 1948, title: "Married Iris!" }] };
  assert.equal(hasEventMentioning(person, 1948, 'iris'), true);
});

test('hasEventMentioning requires the same year', () => {
  const person = { events: [{ year: 2011, title: 'Birth of Oliver' }] };
  assert.equal(hasEventMentioning(person, 2012, 'Oliver'), false);
});

test('hasEventMentioning ignores initials and short tokens to avoid noise matches', () => {
  const person = { events: [{ year: 1990, title: 'A trip to Oslo' }] };
  assert.equal(hasEventMentioning(person, 1990, 'O J'), false);
});

test('hasEventMentioning returns false with no year, no name, or no events', () => {
  assert.equal(hasEventMentioning({ events: [{ year: 2012, title: 'Birth of Oliver' }] }, null, 'Oliver'), false);
  assert.equal(hasEventMentioning({ events: [{ year: 2012, title: 'Birth of Oliver' }] }, 2012, ''), false);
  assert.equal(hasEventMentioning({ events: [] }, 2012, 'Oliver'), false);
});

// ── buildRestingPlacePatch (EditPersonSheet's quick-add box) ────────────────

test('buildRestingPlacePatch: unchecking deceased clears an existing resting_place', () => {
  assert.deepEqual(buildRestingPlacePatch(false, '', { cemetery: 'Old Cemetery', place: 'Old Town' }), { resting_place: null });
});

test('buildRestingPlacePatch: a living person with no resting_place omits the key entirely — real bug report: this used to unconditionally write resting_place:null on every edit to a living person, making the activity feed spuriously report "resting place" as changed for people who were never deceased', () => {
  assert.deepEqual(buildRestingPlacePatch(false, '', null), {});
  assert.deepEqual(buildRestingPlacePatch(false, '', undefined), {});
});

test('buildRestingPlacePatch: an untouched quick box (unchanged text) leaves resting_place completely alone — omits the key', () => {
  assert.deepEqual(buildRestingPlacePatch(true, '', null), {});
  assert.deepEqual(buildRestingPlacePatch(true, 'London, England', { place: 'London, England', cemetery: 'Highgate' }), {});
});

test('buildRestingPlacePatch: a brand-new value with no prior record creates a bare { place } record', () => {
  const result = buildRestingPlacePatch(true, 'Highgate Cemetery, London', null);
  assert.deepEqual(result, { resting_place: { place: 'Highgate Cemetery, London' } });
});

test('buildRestingPlacePatch: clearing the quick box to empty deletes the whole record', () => {
  const result = buildRestingPlacePatch(true, '', { place: 'London, England', cemetery: 'Highgate' });
  assert.deepEqual(result, { resting_place: null });
});

test('buildRestingPlacePatch: editing the quick text on an existing rich record only updates `place`, preserving cemetery/plot/suburb/state/lat/lon', () => {
  const existing = { cemetery: 'Highgate Cemetery', plot: 'Section 12', place: 'London, England', suburb: 'London', state: 'England', country: 'UK', lat: 51.5, lon: -0.1 };
  const result = buildRestingPlacePatch(true, 'Camden, England', existing);
  assert.deepEqual(result, {
    resting_place: { cemetery: 'Highgate Cemetery', plot: 'Section 12', place: 'Camden, England', suburb: 'London', state: 'England', country: 'UK', lat: 51.5, lon: -0.1 },
  });
});

test('buildRestingPlacePatch: whitespace-only differences do not count as a real change', () => {
  const result = buildRestingPlacePatch(true, '  London, England  ', { place: 'London, England' });
  assert.deepEqual(result, {});
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
