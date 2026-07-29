/**
 * Unit tests for lib/worldEvents.js — birthEraContext() specifically, the
 * function powering the profile's "Born" timeline row narration (real
 * feedback: "Born: 4 June 1912" vs. "Born just two years before the First
 * World War... same data, completely different emotional impact").
 * Run with: node tests/worldEvents.test.mjs
 */
import assert from 'node:assert/strict';
import { birthEraContext } from '../src/lib/worldEvents.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('birthEraContext: an exact-year match reads "The same year {event}."', () => {
  // WORLD_EVENTS has { year: 1914, title: 'World War I begins', region: 'global' }
  assert.equal(birthEraContext(1914, 'global'), 'The same year World War I begins.');
});

test('birthEraContext: a birth year before a nearby event reads "N years before {event}."', () => {
  // 1906 is 2 years before the 1908 Ford Model T entry — the nearest global
  // event (1903's Wright brothers is 3 years away), so this is unambiguous.
  const result = birthEraContext(1906, 'global');
  assert.equal(result, 'Two years before Ford introduces the Model T.');
});

test('birthEraContext: a birth year after a nearby event reads "N years after {event}."', () => {
  // 1905 is 2 years after the 1903 Wright brothers flight — the nearest
  // global event (1908's Model T is 3 years away), so this is unambiguous.
  const result = birthEraContext(1905, 'global');
  assert.equal(result, 'Two years after the Wright brothers achieve the first powered flight.');
});

test('birthEraContext: a leading "The"/"A"/"An" is lowercased when embedded mid-sentence', () => {
  // 1912 Titanic entry is titled "The Titanic sinks on its maiden voyage" —
  // confirm the embedded clause reads "the Titanic…", not "The Titanic…".
  assert.equal(birthEraContext(1912, 'global'), 'The same year the Titanic sinks on its maiden voyage.');
});

test('birthEraContext: returns null when nothing curated falls within range — never invents a fact', () => {
  // Deep in a stretch with no curated events within 4 years in either
  // direction (there's no WORLD_EVENTS entry between roughly 1935-1938 for
  // most regions); use a contrived far-future year to be certain nothing
  // qualifies regardless of how the curated list evolves.
  assert.equal(birthEraContext(9999, 'global'), null);
});

test('birthEraContext: a non-numeric or missing birth year returns null', () => {
  assert.equal(birthEraContext(undefined, 'global'), null);
  assert.equal(birthEraContext(null, 'global'), null);
  assert.equal(birthEraContext('unknown', 'global'), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
