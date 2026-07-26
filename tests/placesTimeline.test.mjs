/**
 * Unit tests for lib/placesTimeline.js — the pure layout geometry behind
 * PlacesLived.jsx's horizontal timeline connector.
 * Run with: node tests/placesTimeline.test.mjs
 */
import assert from 'node:assert/strict';
import { buildTimelineLayout, WAYPOINT_W, GAP, DOT_ZONE_H } from '../src/lib/placesTimeline.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('an empty list returns null (nothing to lay out)', () => {
  assert.equal(buildTimelineLayout([]), null);
  assert.equal(buildTimelineLayout(undefined), null);
});

test('a single place still lays out (one point, no path, no crossings)', () => {
  const layout = buildTimelineLayout([{ id: 'a', country: 'Australia' }]);
  assert.equal(layout.points.length, 1);
  assert.equal(layout.pathD, '');
  assert.deepEqual(layout.crossings, []);
  assert.equal(layout.points[0].x, WAYPOINT_W / 2);
  assert.equal(layout.points[0].y, DOT_ZONE_H / 2);
});

test('points are evenly spaced by fixed waypoint width + gap, not by any real-world distance', () => {
  const layout = buildTimelineLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const step = WAYPOINT_W + GAP;
  assert.equal(layout.points[0].x, WAYPOINT_W / 2);
  assert.equal(layout.points[1].x, step + WAYPOINT_W / 2);
  assert.equal(layout.points[2].x, step * 2 + WAYPOINT_W / 2);
  assert.equal(layout.width, 3 * WAYPOINT_W + 2 * GAP);
});

test('every point shares the same y (a flat baseline) — only the connecting path waves, not the dots themselves', () => {
  const layout = buildTimelineLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  for (const p of layout.points) assert.equal(p.y, DOT_ZONE_H / 2);
});

test('pathD starts and ends exactly at the first/last point and uses one Q curve per segment', () => {
  const layout = buildTimelineLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const first = layout.points[0], last = layout.points[layout.points.length - 1];
  assert.ok(layout.pathD.startsWith(`M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`));
  assert.ok(layout.pathD.endsWith(`${last.x.toFixed(1)} ${last.y.toFixed(1)}`));
  assert.equal((layout.pathD.match(/Q/g) || []).length, 2, 'two segments (3 points) means two Q curves');
});

test('a border crossing is only flagged when BOTH sides have a known, differing country', () => {
  const layout = buildTimelineLayout([
    { id: 'a', country: 'Australia' },
    { id: 'b', country: 'Australia' }, // same country — no crossing
    { id: 'c', country: 'Canada' },    // crosses here
    { id: 'd', country: null },        // unknown — never guess a crossing
  ]);
  assert.equal(layout.crossings.length, 1);
  assert.equal(layout.crossings[0].key, 'b-c');
});

test('a crossing marker sits at the horizontal midpoint of its segment', () => {
  const layout = buildTimelineLayout([
    { id: 'a', country: 'Australia' },
    { id: 'b', country: 'Canada' },
  ]);
  const [a, b] = layout.points;
  assert.equal(layout.crossings[0].x, (a.x + b.x) / 2);
});

test('no crossings at all when every place has an unknown country (never fabricated)', () => {
  const layout = buildTimelineLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.deepEqual(layout.crossings, []);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
