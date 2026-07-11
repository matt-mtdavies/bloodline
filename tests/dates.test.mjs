/**
 * Unit tests for lib/dates.js — lifespan() specifically, since it's shared by
 * the profile hero, nameplate, hover card, and insights record books alike.
 * Run with: node tests/dates.test.mjs
 */
import assert from 'node:assert/strict';
import { lifespan } from '../src/lib/dates.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('lifespan: deceased with both dates reads as a plain "born – died" range', () => {
  const p = { is_deceased: true, birth_date: '1905-01-01', death_date: '1985-01-01' };
  assert.equal(lifespan(p), '1905 – 1985');
});

test('lifespan: deceased with only a birth date on record reads "b. YYYY", not a bare year', () => {
  const p = { is_deceased: true, birth_date: '1912-01-01', death_date: undefined };
  assert.equal(lifespan(p), 'b. 1912');
});

test('lifespan: deceased with only a death date on record reads "d. YYYY", not a bare year', () => {
  const p = { is_deceased: true, birth_date: undefined, death_date: '1944-01-01' };
  assert.equal(lifespan(p), 'd. 1944');
});

test('lifespan: deceased with neither date known falls back to "Dates unknown"', () => {
  const p = { is_deceased: true, birth_date: undefined, death_date: undefined };
  assert.equal(lifespan(p), 'Dates unknown');
});

test('lifespan: living person with a known birth year reads "b. YYYY"', () => {
  const p = { is_deceased: false, birth_date: '1985-06-01' };
  assert.equal(lifespan(p), 'b. 1985');
});

test('lifespan: living person with no birth date falls back to "Dates unknown"', () => {
  const p = { is_deceased: false, birth_date: undefined };
  assert.equal(lifespan(p), 'Dates unknown');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
