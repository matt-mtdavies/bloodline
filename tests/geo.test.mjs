/**
 * Unit tests for lib/geo.js — pure distance math over already-geocoded
 * coordinates (see functions/_lib/geocode.js for the actual geocoding).
 * Run with: node tests/geo.test.mjs
 */
import assert from 'node:assert/strict';
import { haversineKm, formatKm } from '../src/lib/geo.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('haversineKm: London to Paris is approximately 344 km', () => {
  const london = { lat: 51.5074, lon: -0.1278 };
  const paris = { lat: 48.8566, lon: 2.3522 };
  const km = haversineKm(london, paris);
  assert.ok(km > 330 && km < 360, `expected ~344km, got ${km}`);
});

test('haversineKm: the same point is 0 km from itself', () => {
  const p = { lat: 51.5074, lon: -0.1278 };
  assert.equal(haversineKm(p, p), 0);
});

test('haversineKm: null when either coordinate is missing or incomplete', () => {
  const p = { lat: 51.5074, lon: -0.1278 };
  assert.equal(haversineKm(null, p), null);
  assert.equal(haversineKm(p, null), null);
  assert.equal(haversineKm({ lat: 51.5 }, p), null, 'a coordinate missing lon must not crash or invent a distance');
});

test('formatKm: rounds to the nearest whole km, null passes through', () => {
  assert.equal(formatKm(17.4), 17);
  assert.equal(formatKm(17.6), 18);
  assert.equal(formatKm(null), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
