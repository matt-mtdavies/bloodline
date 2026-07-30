/**
 * Unit tests for lib/dates.js — lifespan() specifically, since it's shared by
 * the profile hero, nameplate, hover card, and insights record books alike.
 * Run with: node tests/dates.test.mjs
 */
import assert from 'node:assert/strict';
import { lifespan, familySpan, humanLifeSummary } from '../src/lib/dates.js';

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

// ── familySpan (the GEDCOM/FamilySearch import landing moment) ─────────────

const NOW = new Date('2026-07-29');

test('familySpan: living people extend the span through to "now", not just the latest birth year', () => {
  const people = [
    { birth_date: '1912-01-01', is_deceased: false },
    { birth_date: '1990-06-01', is_deceased: false },
  ];
  const span = familySpan(people, NOW);
  assert.equal(span.earliestYear, 1912);
  assert.equal(span.latestYear, 2026);
  assert.equal(span.spanYears, 114);
});

test('familySpan: an all-deceased batch spans to the most recent death year, not "now"', () => {
  const people = [
    { birth_date: '1900-01-01', death_date: '1970-01-01', is_deceased: true },
    { birth_date: '1920-01-01', death_date: '1995-01-01', is_deceased: true },
  ];
  const span = familySpan(people, NOW);
  assert.equal(span.earliestYear, 1900);
  assert.equal(span.latestYear, 1995, 'the later of the two death years, not "now"');
  assert.equal(span.spanYears, 95);
});

test('familySpan: a deceased person with no recorded death year falls back to their own birth year, never "now"', () => {
  const people = [{ birth_date: '1900-01-01', death_date: undefined, is_deceased: true }];
  const span = familySpan(people, NOW);
  assert.equal(span.latestYear, 1900, 'no death year on record and nobody living — never guesses "now"');
  assert.equal(span.spanYears, 0);
});

test('familySpan: people with no birth date at all are ignored when computing the earliest year', () => {
  const people = [
    { birth_date: undefined, is_deceased: false },
    { birth_date: '1950-01-01', is_deceased: false },
  ];
  const span = familySpan(people, NOW);
  assert.equal(span.earliestYear, 1950);
});

test('familySpan: returns null when nobody in the batch has a usable birth year — never invents a span', () => {
  assert.equal(familySpan([], NOW), null);
  assert.equal(familySpan([{ birth_date: undefined }, { birth_date: undefined }], NOW), null);
});

// ── humanLifeSummary (the profile hero's own prose reading of dates) ───────

test('humanLifeSummary: deceased with both dates reads as a full sentence, plural years', () => {
  const p = { is_deceased: true, birth_date: '1905-01-01', death_date: '1985-01-01' };
  assert.deepEqual(humanLifeSummary(p), ['Born 1905', 'Passed away 1985', 'Lived 80 years']);
});

test('humanLifeSummary: a life of exactly one year is singular, not "1 years"', () => {
  const p = { is_deceased: true, birth_date: '1990-01-01', death_date: '1991-01-01' };
  assert.deepEqual(humanLifeSummary(p), ['Born 1990', 'Passed away 1991', 'Lived 1 year']);
});

test('humanLifeSummary: a death in the birth year reads "less than a year", not "Lived 0 years"', () => {
  const p = { is_deceased: true, birth_date: '1990-06-01', death_date: '1990-09-01' };
  assert.deepEqual(humanLifeSummary(p), ['Born 1990', 'Passed away 1990', 'Lived less than a year']);
});

test('humanLifeSummary: deceased with only a birth date omits "Passed away" and "Lived" rather than guessing', () => {
  const p = { is_deceased: true, birth_date: '1912-01-01', death_date: undefined };
  assert.deepEqual(humanLifeSummary(p), ['Born 1912']);
});

test('humanLifeSummary: deceased with only a death date on record', () => {
  const p = { is_deceased: true, birth_date: undefined, death_date: '1944-01-01' };
  assert.deepEqual(humanLifeSummary(p), ['Passed away 1944']);
});

test('humanLifeSummary: deceased with neither date known falls back to "Dates unknown"', () => {
  const p = { is_deceased: true, birth_date: undefined, death_date: undefined };
  assert.deepEqual(humanLifeSummary(p), ['Dates unknown']);
});

test('humanLifeSummary: a living person reads "Born YYYY" plus their current age', () => {
  const p = { is_deceased: false, birth_date: '1990-01-01' };
  const parts = humanLifeSummary(p);
  assert.equal(parts[0], 'Born 1990');
  assert.match(parts[1], /^\d+ years? old$/);
});

test('humanLifeSummary: living person with no birth date falls back to "Dates unknown"', () => {
  const p = { is_deceased: false, birth_date: undefined };
  assert.deepEqual(humanLifeSummary(p), ['Dates unknown']);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
