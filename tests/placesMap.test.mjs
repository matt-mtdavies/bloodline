/**
 * Unit tests for lib/placesMap.js — the pure projection layer behind
 * PlacesMap.jsx's "constellation map" visualization.
 * Run with: node tests/placesMap.test.mjs
 */
import assert from 'node:assert/strict';
import { projectPlaces } from '../src/lib/placesMap.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const OPTS = { width: 340, height: 176, padding: 30, minRadius: 5, maxRadius: 12, now: 2026 };

test('fewer than 2 geocoded residences returns null (never a lone floating dot)', () => {
  assert.equal(projectPlaces([], OPTS), null);
  assert.equal(projectPlaces([{ id: 'a', place: 'X', lat: 1, lon: 1 }], OPTS), null);
  // Two residences, only one geocoded — still below the floor.
  assert.equal(projectPlaces([
    { id: 'a', place: 'X', lat: 1, lon: 1 },
    { id: 'b', place: 'Y', lat: null, lon: null },
  ], OPTS), null);
});

test('residences with no lat/lon are excluded from the plot, not treated as an error', () => {
  const result = projectPlaces([
    { id: 'a', place: 'Cardiff', lat: 51.48, lon: -3.18, from_year: 1990 },
    { id: 'b', place: 'Undated', lat: null, lon: null, from_year: 1995 },
    { id: 'c', place: 'Fremantle', lat: -32.05, lon: 115.75, from_year: 2000 },
  ], OPTS);
  assert.equal(result.points.length, 2);
  assert.ok(!result.points.some((p) => p.place === 'Undated'));
});

test('points are ordered chronologically regardless of input array order, unknown years sort last', () => {
  const result = projectPlaces([
    { id: 'c', place: 'Third', lat: 0, lon: 20, from_year: 2010 },
    { id: 'a', place: 'First', lat: 0, lon: 0, from_year: 1990 },
    { id: 'u', place: 'Unknown year', lat: 0, lon: 30 }, // no from_year at all
    { id: 'b', place: 'Second', lat: 0, lon: 10, from_year: 2000 },
  ], OPTS);
  assert.deepEqual(result.points.map((p) => p.place), ['First', 'Second', 'Third', 'Unknown year']);
});

test('lat/lon normalize into the padded box, with higher latitude plotted further up (smaller y)', () => {
  const result = projectPlaces([
    { id: 'north', place: 'North', lat: 60, lon: 0, from_year: 1990 },
    { id: 'south', place: 'South', lat: 10, lon: 0, from_year: 2000 },
  ], OPTS);
  const north = result.points.find((p) => p.place === 'North');
  const south = result.points.find((p) => p.place === 'South');
  assert.ok(north.y < south.y, 'higher latitude must plot with a smaller y (further up)');
  for (const p of result.points) {
    assert.ok(p.x >= OPTS.padding - 0.5 && p.x <= OPTS.width - OPTS.padding + 0.5);
    assert.ok(p.y >= OPTS.padding - 0.5 && p.y <= OPTS.height - OPTS.padding + 0.5);
  }
});

test('all points sharing the exact same coordinates does not divide by zero, and the separation pass pulls them apart so both are visible', () => {
  const result = projectPlaces([
    { id: 'a', place: 'A', lat: 10, lon: 10, from_year: 1990 },
    { id: 'b', place: 'B', lat: 10, lon: 10, from_year: 2000 },
  ], OPTS);
  assert.ok(result);
  for (const p of result.points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'no NaN/Infinity from a zero-distance division');
  }
  const [a, b] = result.points;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(dist > 0, 'two dots at the identical coordinate must still end up visually distinguishable, not perfectly stacked');
});

test('separate() pulls two nearby-but-distinct points apart until they no longer overlap', () => {
  // Cardiff and Bristol are genuinely close (~40km) relative to a plot whose
  // bounding box also spans Toronto and Australia — without separation their
  // raw normalized positions would nearly coincide.
  const result = projectPlaces([
    { id: 'cardiff', place: 'Cardiff, Wales', lat: 51.48, lon: -3.18, from_year: 1985, to_year: 2003 },
    { id: 'bristol', place: 'Bristol, England', lat: 51.45, lon: -2.59, from_year: 2003, to_year: 2015 },
    { id: 'toronto', place: 'Toronto, Canada', lat: 43.65, lon: -79.38, from_year: 2015, to_year: 2019 },
    { id: 'fg', place: 'Fountain Gate, Victoria', lat: -38.08, lon: 145.32, from_year: 2019, to_year: null },
  ], OPTS);
  const cardiff = result.points.find((p) => p.id === 'cardiff');
  const bristol = result.points.find((p) => p.id === 'bristol');
  const dist = Math.hypot(bristol.x - cardiff.x, bristol.y - cardiff.y);
  assert.ok(dist >= cardiff.r + bristol.r + 9, `Cardiff and Bristol must end up at least combined-radius apart, got ${dist}`);
});

test('labelAnchor keeps edge-hugging labels inside the box (start on the left edge, end on the right, middle elsewhere)', () => {
  const result = projectPlaces([
    { id: 'a', place: 'Left', lat: 0, lon: 0, from_year: 1990 },
    { id: 'b', place: 'Right', lat: 0, lon: 100, from_year: 2000 },
  ], OPTS);
  const left = result.points.find((p) => p.place === 'Left');
  const right = result.points.find((p) => p.place === 'Right');
  assert.equal(left.labelAnchor, 'start');
  assert.equal(right.labelAnchor, 'end');
});

test('radius scales with known duration; a residence missing a year gets the midpoint radius, never a guess', () => {
  const result = projectPlaces([
    { id: 'short', place: 'Short stay', lat: 0, lon: 0, from_year: 2018, to_year: 2019 }, // 1 year
    { id: 'long', place: 'Long stay', lat: 0, lon: 10, from_year: 1990, to_year: 2020 }, // 30 years
    { id: 'unknown', place: 'No years', lat: 0, lon: 20 },
  ], OPTS);
  const short = result.points.find((p) => p.place === 'Short stay');
  const long = result.points.find((p) => p.place === 'Long stay');
  const unknown = result.points.find((p) => p.place === 'No years');
  assert.ok(short.r < long.r, 'a longer stay must plot a larger dot than a shorter one');
  assert.equal(short.r, OPTS.minRadius);
  assert.equal(long.r, OPTS.maxRadius);
  assert.equal(unknown.r, (OPTS.minRadius + OPTS.maxRadius) / 2, 'unknown duration gets the midpoint radius');
});

test('an open-ended (to_year: null) residence is marked current; the ongoing duration is measured against `now`', () => {
  const result = projectPlaces([
    { id: 'old', place: 'Old home', lat: 0, lon: 0, from_year: 1990, to_year: 2010 },
    { id: 'now', place: 'Current home', lat: 0, lon: 10, from_year: 2010, to_year: null },
  ], OPTS);
  const current = result.points.find((p) => p.place === 'Current home');
  assert.equal(current.current, true);
  assert.equal(result.points.find((p) => p.place === 'Old home').current, false);
});

test('with no open-ended residence at all, the chronologically LAST one is marked current', () => {
  const result = projectPlaces([
    { id: 'a', place: 'Early', lat: 0, lon: 0, from_year: 1900, to_year: 1920 },
    { id: 'b', place: 'Latest', lat: 0, lon: 10, from_year: 1920, to_year: 1950 },
  ], OPTS);
  assert.equal(result.points.find((p) => p.place === 'Latest').current, true);
  assert.equal(result.points.find((p) => p.place === 'Early').current, false);
});

test('pathD starts at the first point, ends at the last, and visits every point via Q curves', () => {
  const result = projectPlaces([
    { id: 'a', place: 'A', lat: 0, lon: 0, from_year: 1990 },
    { id: 'b', place: 'B', lat: 10, lon: 10, from_year: 2000 },
    { id: 'c', place: 'C', lat: 20, lon: 20, from_year: 2010 },
  ], OPTS);
  const first = result.points[0], last = result.points[result.points.length - 1];
  assert.ok(result.pathD.startsWith(`M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`));
  assert.ok(result.pathD.endsWith(`${last.x.toFixed(1)} ${last.y.toFixed(1)}`));
  assert.equal((result.pathD.match(/Q/g) || []).length, 2, 'two segments (3 points) means two Q curves');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
