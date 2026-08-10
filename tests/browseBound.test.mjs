/**
 * Unit tests for graph.js's boundWorkingSet — the browse-density bound.
 * Run with: node tests/browseBound.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, boundWorkingSet } from '../src/data/graph.js';
import { maxBrowseAnchorsFor, MAX_BROWSE_ANCHORS_PHONE, MAX_BROWSE_ANCHORS_DESKTOP } from '../src/lib/browseBoundFlag.js';

let passed = 0, failed = 0;
const results = [];
function test(label, fn) {
  try { fn(); passed++; results.push({ ok: true, label }); }
  catch (e) { failed++; results.push({ ok: false, label, error: e.message }); }
}

const person = (id) => ({ id, display_name: id, gender: null, is_deceased: false });
const parentEdge = (p, c) => ({ type: 'parent', from_person: p, to_person: c, qualifier: 'biological', partner_status: null });

/* A long chain: a → b → c → d → e → f → g (each the parent of the next).
 * Distance from any node is just how many links away it is. */
const CHAIN = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const chainGraph = buildGraph(
  CHAIN.map(person),
  CHAIN.slice(0, -1).map((id, i) => parentEdge(id, CHAIN[i + 1])),
);

test('under the cap, every anchor is kept untouched', () => {
  const out = boundWorkingSet(chainGraph, ['a', 'b', 'c'], 'a', 5);
  assert.deepEqual([...out].sort(), ['a', 'b', 'c']);
});

test('over the cap, the far end of the trail is released', () => {
  const out = boundWorkingSet(chainGraph, CHAIN, 'a', 3);
  assert.ok(out.has('a'), 'the active person is always kept');
  assert.ok(!out.has('g'), 'the furthest anchor is released');
  assert.ok(out.size <= 3 || out.has('b'), 'nearby anchors survive');
});

test('the active person is never released, even at a cap of 1', () => {
  const out = boundWorkingSet(chainGraph, CHAIN, 'd', 1);
  assert.ok(out.has('d'));
});

test('everyone within keepRadius is kept even when that exceeds the cap', () => {
  // From 'd', the 2-hop neighbourhood is b,c,d,e,f — five anchors — but the
  // cap here is 2. Rule 1 outranks the cap: the family you are reading is
  // never released.
  const out = boundWorkingSet(chainGraph, CHAIN, 'd', 2, 2);
  for (const id of ['b', 'c', 'd', 'e', 'f']) {
    assert.ok(out.has(id), `${id} is within 2 hops and must be kept`);
  }
  assert.ok(!out.has('a'), 'a is 3 hops away and beyond the budget');
  assert.ok(!out.has('g'), 'g is 3 hops away and beyond the budget');
});

test('keepRadius 0 keeps only the active person plus whatever budget allows', () => {
  const out = boundWorkingSet(chainGraph, CHAIN, 'a', 2, 0);
  assert.ok(out.has('a'));
  assert.equal(out.size, 2);
});

test('closer anchors are preferred over further ones', () => {
  const out = boundWorkingSet(chainGraph, CHAIN, 'a', 4, 0);
  assert.ok(out.has('b'), 'the nearest neighbour is kept');
  assert.ok(!out.has('g'), 'the furthest is dropped');
});

test('an anchor unreachable from the active person is released first', () => {
  const g = buildGraph(
    [...CHAIN, 'island'].map(person),
    CHAIN.slice(0, -1).map((id, i) => parentEdge(id, CHAIN[i + 1])),
  );
  const out = boundWorkingSet(g, [...CHAIN, 'island'], 'a', 3, 0);
  assert.ok(!out.has('island'), 'a disconnected anchor is infinitely far, so it goes first');
});

test('the result is never larger than the cap unless keepRadius forces it', () => {
  const out = boundWorkingSet(chainGraph, CHAIN, 'a', 3, 0);
  assert.ok(out.size <= 3, `expected <= 3, got ${out.size}`);
});

test('it is a pure read — the input collection is not mutated', () => {
  const anchors = [...CHAIN];
  boundWorkingSet(chainGraph, anchors, 'a', 2);
  assert.deepEqual(anchors, CHAIN, 'the caller keeps its full set; nothing is forgotten');
});

test('it is deterministic — identical inputs give identical output', () => {
  const a = [...boundWorkingSet(chainGraph, CHAIN, 'd', 4)].sort();
  const b = [...boundWorkingSet(chainGraph, CHAIN, 'd', 4)].sort();
  assert.deepEqual(a, b);
});

test('the phone budget is smaller than the desktop one, and both are used', () => {
  assert.equal(maxBrowseAnchorsFor(390), MAX_BROWSE_ANCHORS_PHONE);
  assert.equal(maxBrowseAnchorsFor(1440), MAX_BROWSE_ANCHORS_DESKTOP);
  assert.ok(MAX_BROWSE_ANCHORS_PHONE < MAX_BROWSE_ANCHORS_DESKTOP);
});

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : ` — ${r.error}`}`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
