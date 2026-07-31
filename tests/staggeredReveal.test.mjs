/**
 * Unit tests for src/lib/staggeredReveal.js — the shared ripple-reveal
 * scheduler (extracted from App.jsx's toggleExpandAll for Phase 4's
 * perimeter-based initial working set; see the module's own header).
 * Run with: node tests/staggeredReveal.test.mjs
 */
import assert from 'node:assert/strict';
import { planRevealSteps, scheduleStaggeredReveal, RIPPLE_CHUNK_SIZE } from '../src/lib/staggeredReveal.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── planRevealSteps ─────────────────────────────────────────────────────

test('planRevealSteps groups ids into layers ordered by distance, closest first', () => {
  const dist = new Map([['a', 2], ['b', 1], ['c', 1], ['d', 2]]);
  const steps = planRevealSteps(['a', 'b', 'c', 'd'], dist, new Set());
  assert.equal(steps.length, 2, 'two distinct distances -> two steps (each layer fits in one chunk)');
  assert.deepEqual(new Set(steps[0].ids), new Set(['b', 'c']), 'distance-1 layer comes first');
  assert.deepEqual(new Set(steps[1].ids), new Set(['a', 'd']), 'distance-2 layer comes second');
});

test('planRevealSteps excludes ids already in alreadyVisible', () => {
  const dist = new Map([['a', 1], ['b', 1]]);
  const steps = planRevealSteps(['a', 'b'], dist, new Set(['a']));
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].ids, ['b']);
});

test('planRevealSteps returns [] when everything is already visible', () => {
  const dist = new Map([['a', 1]]);
  const steps = planRevealSteps(['a'], dist, new Set(['a']));
  assert.deepEqual(steps, []);
});

test('planRevealSteps treats a missing distance entry as Infinity (sorts last)', () => {
  const dist = new Map([['known', 1]]);
  const steps = planRevealSteps(['unknown', 'known'], dist, new Set());
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].ids, ['known']);
  assert.deepEqual(steps[1].ids, ['unknown']);
});

test('planRevealSteps chunks a single large layer into RIPPLE_CHUNK_SIZE-sized steps, marking only the last as isLayerEnd', () => {
  const ids = Array.from({ length: RIPPLE_CHUNK_SIZE * 2 + 5 }, (_, i) => `p${i}`);
  const dist = new Map(ids.map((id) => [id, 1]));
  const steps = planRevealSteps(ids, dist, new Set());
  assert.equal(steps.length, 3, 'ceil((2*CHUNK+5)/CHUNK) = 3 chunks');
  assert.equal(steps[0].ids.length, RIPPLE_CHUNK_SIZE);
  assert.equal(steps[1].ids.length, RIPPLE_CHUNK_SIZE);
  assert.equal(steps[2].ids.length, 5);
  assert.equal(steps[0].isLayerEnd, false);
  assert.equal(steps[1].isLayerEnd, false);
  assert.equal(steps[2].isLayerEnd, true);
  // every id accounted for exactly once
  const all = steps.flatMap((s) => s.ids);
  assert.deepEqual(new Set(all), new Set(ids));
  assert.equal(all.length, ids.length);
});

test('planRevealSteps: a later layer\'s final chunk carries more weight than an earlier one (settling ripple)', () => {
  const ids = Array.from({ length: RIPPLE_CHUNK_SIZE + 1 }, (_, i) => `p${i}`).concat(['q0']);
  const dist = new Map(ids.slice(0, -1).map((id) => [id, 1]).concat([['q0', 2]]));
  const steps = planRevealSteps(ids, dist, new Set());
  const layer1EndWeight = steps.find((s) => s.isLayerEnd && s.ids.includes('p1'.length ? steps[1].ids[0] : null))?.weight
    ?? steps[1].weight; // second step is layer-1's final chunk
  const layer2EndWeight = steps[steps.length - 1].weight; // last step overall = layer-2's only (final) chunk
  assert.ok(layer2EndWeight > layer1EndWeight, 'weight should grow slightly with layer index');
});

// ── scheduleStaggeredReveal ──────────────────────────────────────────────

test('scheduleStaggeredReveal: instant mode delivers everything in one synchronous batch', () => {
  const dist = new Map([['a', 1], ['b', 5], ['c', 2]]);
  const batches = [];
  const cancel = scheduleStaggeredReveal(['a', 'b', 'c'], dist, new Set(), (ids) => batches.push(ids), { instant: true });
  assert.equal(batches.length, 1, 'reduced-motion must deliver everything at once, not a real ripple');
  assert.deepEqual(new Set(batches[0]), new Set(['a', 'b', 'c']));
  cancel(); // must be safe to call even though nothing is scheduled
});

test('scheduleStaggeredReveal: no-op (never calls onBatch, returns a safe no-op cancel) when nothing new to reveal', () => {
  const dist = new Map([['a', 1]]);
  let called = false;
  const cancel = scheduleStaggeredReveal(['a'], dist, new Set(['a']), () => { called = true; });
  assert.equal(called, false);
  cancel();
});

await atest('scheduleStaggeredReveal: real (non-instant) mode delivers every id exactly once, in distance order, across multiple onBatch calls', async () => {
  const dist = new Map([['near1', 1], ['near2', 1], ['far1', 2]]);
  const batches = [];
  await new Promise((resolve) => {
    scheduleStaggeredReveal(['near1', 'near2', 'far1'], dist, new Set(), (ids) => {
      batches.push(ids);
      if (batches.flat().length === 3) resolve();
    });
  });
  assert.ok(batches.length >= 2, 'distance-1 and distance-2 ids must arrive in separate batches');
  const flat = batches.flat();
  assert.deepEqual(new Set(flat), new Set(['near1', 'near2', 'far1']));
  assert.equal(flat.length, 3, 'no id delivered twice');
  // the distance-2 id must not appear before both distance-1 ids have been delivered
  const farIndex = flat.indexOf('far1');
  assert.ok(farIndex >= 2, 'closer ids must be revealed before the farther one');
});

test('scheduleStaggeredReveal: cancel() stops further batches from firing', async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `p${i}`);
  const dist = new Map(ids.map((id, i) => [id, i < 250 ? 1 : 2])); // two big layers, guarantees multiple steps
  const batches = [];
  const cancel = scheduleStaggeredReveal(ids, dist, new Set(), (b) => batches.push(b));
  cancel(); // cancel before the (only synchronous) first batch's follow-up timer fires
  const countRightAfterCancel = batches.length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(batches.length, countRightAfterCancel, 'no further batches must fire after cancel()');
  assert.ok(batches.length < Math.ceil(ids.length / 40) * 2, 'sanity: genuinely stopped early, not coincidentally finished');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
