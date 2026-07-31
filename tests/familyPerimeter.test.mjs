/**
 * Unit tests for src/lib/familyPerimeter.js's pure pieces (the fetch
 * helpers need a real fetch/DOM environment and are exercised live via
 * Playwright instead — see the Phase 3/4 PR descriptions).
 * Run with: node tests/familyPerimeter.test.mjs
 */
import assert from 'node:assert/strict';
import { engineLevelFor, PERIMETER_OPTIONS } from '../src/lib/familyPerimeter.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('engineLevelFor maps first/second/third to 1/2/3', () => {
  assert.equal(engineLevelFor('first'), 1);
  assert.equal(engineLevelFor('second'), 2);
  assert.equal(engineLevelFor('third'), 3);
});

test('engineLevelFor maps everyone to the string \'everyone\', not a number', () => {
  assert.equal(engineLevelFor('everyone'), 'everyone');
});

test('engineLevelFor falls back to \'everyone\' for anything unrecognized — never narrows on bad data', () => {
  assert.equal(engineLevelFor('fourth'), 'everyone');
  assert.equal(engineLevelFor(undefined), 'everyone');
  assert.equal(engineLevelFor(null), 'everyone');
  assert.equal(engineLevelFor(''), 'everyone');
});

test('every PERIMETER_OPTIONS value maps to a real engine level (a number, or literally \'everyone\')', () => {
  for (const opt of PERIMETER_OPTIONS) {
    const mapped = engineLevelFor(opt.value);
    assert.ok(mapped === 'everyone' || typeof mapped === 'number', `unexpected mapping for ${opt.value}: ${mapped}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
