/**
 * Unit tests for lib/educationTerms.js — resolveStageLabel's country-adaptive
 * terminology ("Primary School" in Australia, "Elementary School" in Canada).
 * Run with: node tests/educationTerms.test.mjs
 */
import assert from 'node:assert/strict';
import { resolveStageLabel } from '../src/lib/educationTerms.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('Australia: primary/secondary read the same as the generic pack, trade reads as TAFE', () => {
  assert.equal(resolveStageLabel('primary', 'Australia'), 'Primary School');
  assert.equal(resolveStageLabel('secondary', 'Australia'), 'Secondary School');
  assert.equal(resolveStageLabel('trade', 'Australia'), 'TAFE');
  assert.equal(resolveStageLabel('university', 'Australia'), 'University');
});

test('Canada: primary reads as Elementary School, distinct from Australia', () => {
  assert.equal(resolveStageLabel('primary', 'Canada'), 'Elementary School');
  assert.equal(resolveStageLabel('trade', 'Canada'), 'Trade School');
});

test('United States: secondary reads as High School, primary as Elementary School', () => {
  assert.equal(resolveStageLabel('primary', 'United States'), 'Elementary School');
  assert.equal(resolveStageLabel('secondary', 'United States'), 'High School');
});

test('United Kingdom: trade reads as Further Education College', () => {
  assert.equal(resolveStageLabel('trade', 'United Kingdom'), 'Further Education College');
});

test('common aliases normalize to the same pack as the canonical country name', () => {
  assert.equal(resolveStageLabel('primary', 'USA'), 'Elementary School');
  assert.equal(resolveStageLabel('primary', 'United States of America'), 'Elementary School');
  assert.equal(resolveStageLabel('trade', 'UK'), 'Further Education College');
  assert.equal(resolveStageLabel('trade', 'Great Britain'), 'Further Education College');
});

test('an unrecognized or missing country falls back to the generic pack', () => {
  assert.equal(resolveStageLabel('primary', 'Narnia'), 'Primary School');
  assert.equal(resolveStageLabel('trade', 'Narnia'), 'Vocational School');
  assert.equal(resolveStageLabel('primary', null), 'Primary School');
  assert.equal(resolveStageLabel('primary', ''), 'Primary School');
});

test('an unrecognized stage key falls back to a generic "Education" label', () => {
  assert.equal(resolveStageLabel('bogus', 'Australia'), 'Education');
});

test('country matching is case-insensitive', () => {
  assert.equal(resolveStageLabel('trade', 'australia'), 'TAFE');
  assert.equal(resolveStageLabel('trade', 'AUSTRALIA'), 'TAFE');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
