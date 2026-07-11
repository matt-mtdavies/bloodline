/**
 * Unit tests for lib/profile.js — completeness + life events.
 * Run with: node tests/profile.test.mjs
 */
import assert from 'node:assert/strict';
import { lifeEvents } from '../src/lib/profile.js';

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

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
