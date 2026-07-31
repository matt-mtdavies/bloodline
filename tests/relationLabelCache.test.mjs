/**
 * Unit tests for lib/relationLabelCache.js — the per-visible-row memoization
 * SearchOverlow's perimeterInfo() uses (Codex review, PR #90 P2: relationLabel
 * can walk two ancestor traversals for a distant person, and was previously
 * recomputed on every render for every mounted row).
 * Run with: node tests/relationLabelCache.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { getCachedRelationLabel } from '../src/lib/relationLabelCache.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function fixture() {
  const people = [
    { id: 'viewer', display_name: 'Viewer', gender: 'female' },
    { id: 'parent', display_name: 'Parent', gender: 'male' },
    { id: 'sibling', display_name: 'Sibling', gender: 'female' },
  ];
  const relationships = [
    { id: 'r1', type: 'parent', from_person: 'parent', to_person: 'viewer', qualifier: 'biological' },
    { id: 'r2', type: 'parent', from_person: 'parent', to_person: 'sibling', qualifier: 'biological' },
  ];
  return buildGraph(people, relationships);
}

test('getCachedRelationLabel: first call computes the real relationship and stores it', () => {
  const graph = fixture();
  const cache = new Map();
  const label = getCachedRelationLabel(cache, graph, 'viewer', 'parent', null);
  assert.equal(label, 'Father');
  assert.equal(cache.get('parent'), 'Father');
});

test('getCachedRelationLabel: a second call for the same id returns the cached value verbatim, never recomputing — proven by pre-seeding a sentinel the real computation could never produce', () => {
  const graph = fixture();
  const cache = new Map();
  cache.set('parent', '__CACHED_SENTINEL__');
  const label = getCachedRelationLabel(cache, graph, 'viewer', 'parent', null);
  assert.equal(label, '__CACHED_SENTINEL__', 'a cache hit must short-circuit before relationLabel ever runs again');
});

test('getCachedRelationLabel: different ids are cached independently in the same Map', () => {
  const graph = fixture();
  const cache = new Map();
  const parentLabel = getCachedRelationLabel(cache, graph, 'viewer', 'parent', null);
  const siblingLabel = getCachedRelationLabel(cache, graph, 'viewer', 'sibling', null);
  assert.equal(parentLabel, 'Father');
  assert.equal(siblingLabel, 'Half-Sister'); // only one shared parent in this fixture
  assert.equal(cache.size, 2);
});

test('getCachedRelationLabel: a fresh cache (simulating graph/viewerId/kinTerms invalidation) recomputes independently of a stale one', () => {
  const graph = fixture();
  const staleCache = new Map();
  staleCache.set('parent', '__STALE_FROM_A_DIFFERENT_VIEWER__');
  const freshCache = new Map();
  const freshLabel = getCachedRelationLabel(freshCache, graph, 'viewer', 'parent', null);
  assert.equal(freshLabel, 'Father', 'a fresh cache must never see the stale one\'s entries');
  assert.notEqual(freshCache.get('parent'), staleCache.get('parent'));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
