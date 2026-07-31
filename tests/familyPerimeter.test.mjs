/**
 * Unit tests for src/lib/familyPerimeter.js's pure pieces (the fetch
 * helpers need a real fetch/DOM environment and are exercised live via
 * Playwright instead — see the Phase 3/4 PR descriptions).
 * Run with: node tests/familyPerimeter.test.mjs
 */
import assert from 'node:assert/strict';
import { engineLevelFor, PERIMETER_OPTIONS, isPerimeterActive } from '../src/lib/familyPerimeter.js';

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

// ── isPerimeterActive (Codex review, PR #89 round 1) ────────────────────
// A recommendation is a SUGGESTION shown in Settings, never a member's own
// choice — treating it as active silently narrows a brand-new member's
// tree before they've agreed to anything. Only a genuinely EXPLICIT,
// narrower-than-'everyone' saved preference should ever activate it.

test('isPerimeterActive: an explicit, narrower-than-everyone preference is active', () => {
  const pref = { perimeterLevel: 'second', hasSavedPreference: true, isRecommendation: false };
  assert.equal(isPerimeterActive(pref, true), true);
});

test('isPerimeterActive: a planted RECOMMENDATION (never confirmed) is NOT active, even though hasSavedPreference is true', () => {
  const pref = { perimeterLevel: 'second', hasSavedPreference: true, isRecommendation: true };
  assert.equal(isPerimeterActive(pref, true), false);
});

test('isPerimeterActive: an explicit \'everyone\' preference is not active (nothing to narrow)', () => {
  const pref = { perimeterLevel: 'everyone', hasSavedPreference: true, isRecommendation: false };
  assert.equal(isPerimeterActive(pref, true), false);
});

test('isPerimeterActive: no saved preference at all (the default GET response) is not active', () => {
  const pref = { perimeterLevel: 'everyone', hasSavedPreference: false, isRecommendation: false };
  assert.equal(isPerimeterActive(pref, true), false);
});

test('isPerimeterActive: an unclaimed viewer is never active regardless of what the preference says', () => {
  const pref = { perimeterLevel: 'first', hasSavedPreference: true, isRecommendation: false };
  assert.equal(isPerimeterActive(pref, false), false);
});

test('isPerimeterActive: null/unavailable preference states are not active', () => {
  assert.equal(isPerimeterActive(null, true), false);
  assert.equal(isPerimeterActive({ unavailable: true }, true), false);
  assert.equal(isPerimeterActive(undefined, true), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
