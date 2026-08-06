/**
 * Unit tests for viz/familyLayout.js — the structural rules the organic bubble
 * tree arranges itself around: partner pods on one horizontal line (including
 * former partners), children centred and evenly spread beneath their parents,
 * and parents held above their children.
 * Run with: node tests/familyLayout.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { buildFamilyStructure, applyFamilyForces, POD_GAP } from '../src/viz/familyLayout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });
const parentEdge = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null,
});
const partnerEdge = (a, b, status = 'current') => ({
  type: 'partner', from_person: a, to_person: b, partner_status: status,
});

const all = () => true;

// Runs the force to convergence so the assertions describe where the layout
// SETTLES, not one tick's nudge. Mirrors the simulation's own warm-up loop.
function settle(structure, nodes, ticks = 400) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < ticks; i++) {
    for (const n of nodes) { n.vx = 0; n.vy = 0; }
    applyFamilyForces(structure, nodeById, 0.3);
    for (const n of nodes) { n.x += n.vx; n.y += n.vy; }
  }
  return nodeById;
}

test('a couple forms one pod; a lone person forms none', () => {
  const g = buildGraph(
    [person('a'), person('b'), person('solo')],
    [partnerEdge('a', 'b')],
  );
  const s = buildFamilyStructure(g, all);
  assert.equal(s.pods.length, 1);
  assert.deepEqual([...s.pods[0].ids].sort(), ['a', 'b']);
  assert.ok(!s.podOf.has('solo'));
});

test('a former partner is in the pod too — the ask was explicitly both', () => {
  const g = buildGraph(
    [person('a'), person('ex')],
    [partnerEdge('a', 'ex', 'former')],
  );
  const s = buildFamilyStructure(g, all);
  assert.equal(s.pods.length, 1);
  assert.deepEqual([...s.pods[0].ids].sort(), ['a', 'ex']);
});

test('someone with a current AND a former partner forms ONE pod of three', () => {
  const g = buildGraph(
    [person('a'), person('now'), person('ex')],
    [partnerEdge('a', 'now'), partnerEdge('a', 'ex', 'former')],
  );
  const s = buildFamilyStructure(g, all);
  assert.equal(s.pods.length, 1);
  assert.equal(s.pods[0].ids.length, 3);
  // The hub sits between the two chapters: former to the left, current right.
  const off = s.pods[0].offset;
  assert.ok(off.get('ex') < off.get('a'), 'former partner sits left of the hub');
  assert.ok(off.get('now') > off.get('a'), 'current partner sits right of the hub');
});

test('pod offsets are centred on the pod, not on its anchor', () => {
  const g = buildGraph(
    [person('a'), person('x'), person('y')],
    [partnerEdge('a', 'x'), partnerEdge('a', 'y')],
  );
  const s = buildFamilyStructure(g, all);
  const sum = [...s.pods[0].offset.values()].reduce((t, o) => t + o, 0);
  assert.ok(Math.abs(sum) < 1e-9, `offsets should sum to 0, got ${sum}`);
});

test('pod ordering is deterministic — the same graph never flips left/right', () => {
  const people = [person('a'), person('now'), person('ex')];
  const rels = [partnerEdge('a', 'now'), partnerEdge('a', 'ex', 'former')];
  const first = buildFamilyStructure(buildGraph(people, rels), all);
  const second = buildFamilyStructure(buildGraph([...people].reverse(), [...rels].reverse()), all);
  for (const id of ['a', 'now', 'ex']) {
    assert.equal(first.podOf.get(id).offset.get(id), second.podOf.get(id).offset.get(id));
  }
});

test('partners settle onto the same horizontal line, spaced side by side', () => {
  const g = buildGraph([person('a'), person('b')], [partnerEdge('a', 'b')]);
  const s = buildFamilyStructure(g, all);
  // Deliberately start them STACKED — the reported bug's exact shape.
  const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 240 }];
  const byId = settle(s, nodes);
  assert.ok(
    Math.abs(byId.get('a').y - byId.get('b').y) < 1,
    'partners end up on the same Y',
  );
  assert.ok(
    Math.abs(Math.abs(byId.get('a').x - byId.get('b').x) - POD_GAP) < 1,
    'partners end up one pod gap apart horizontally',
  );
});

test('siblings sharing parents form one child group, in the app display order', () => {
  const g = buildGraph(
    [
      person('mum'), person('dad'),
      person('young', { birth_date: '2005-01-01' }),
      person('old', { birth_date: '1999-01-01' }),
    ],
    [
      parentEdge('mum', 'young'), parentEdge('dad', 'young'),
      parentEdge('mum', 'old'), parentEdge('dad', 'old'),
    ],
  );
  const s = buildFamilyStructure(g, all);
  assert.equal(s.childGroups.length, 1);
  assert.deepEqual(s.childGroups[0].kids, ['old', 'young'], 'oldest first');
});

test('half-siblings with different parent sets are separate groups', () => {
  const g = buildGraph(
    [person('dad'), person('m1'), person('m2'), person('k1'), person('k2')],
    [
      parentEdge('dad', 'k1'), parentEdge('m1', 'k1'),
      parentEdge('dad', 'k2'), parentEdge('m2', 'k2'),
    ],
  );
  const s = buildFamilyStructure(g, all);
  assert.equal(s.childGroups.length, 2);
});

test('children settle centred under their parents and evenly spread', () => {
  const g = buildGraph(
    [
      person('mum'), person('dad'),
      person('k1', { birth_date: '1990-01-01' }),
      person('k2', { birth_date: '1992-01-01' }),
      person('k3', { birth_date: '1994-01-01' }),
    ],
    [
      partnerEdge('mum', 'dad'),
      parentEdge('mum', 'k1'), parentEdge('dad', 'k1'),
      parentEdge('mum', 'k2'), parentEdge('dad', 'k2'),
      parentEdge('mum', 'k3'), parentEdge('dad', 'k3'),
    ],
  );
  const s = buildFamilyStructure(g, all);
  const nodes = [
    { id: 'mum', x: 0, y: 0 }, { id: 'dad', x: 120, y: 0 },
    // Scattered wherever they happened to fit — the reported starting state.
    { id: 'k1', x: -900, y: 300 }, { id: 'k2', x: 60, y: 300 }, { id: 'k3', x: 800, y: 300 },
  ];
  const byId = settle(s, nodes);
  const parentMid = (byId.get('mum').x + byId.get('dad').x) / 2;
  const kids = ['k1', 'k2', 'k3'].map((id) => byId.get(id).x);
  const kidMid = (Math.min(...kids) + Math.max(...kids)) / 2;
  assert.ok(Math.abs(kidMid - parentMid) < 2, 'the sibling row is centred under the parents');
  const gaps = [kids[1] - kids[0], kids[2] - kids[1]];
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 2, `siblings are evenly spread (gaps ${gaps})`);
  assert.ok(gaps[0] > 0 && gaps[1] > 0, 'display order is preserved left to right');
});

test('an inverted parent is pushed back above their child; a correct pair is untouched', () => {
  const g = buildGraph([person('p'), person('c')], [parentEdge('p', 'c')]);
  const s = buildFamilyStructure(g, all);

  const inverted = [{ id: 'p', x: 0, y: 300 }, { id: 'c', x: 0, y: 0 }];
  const after = settle(s, inverted);
  assert.ok(after.get('p').y < after.get('c').y, 'parent ends up above the child');

  const correct = [{ id: 'p', x: 0, y: 0 }, { id: 'c', x: 0, y: 400 }];
  const untouched = settle(s, correct, 50);
  assert.equal(untouched.get('p').y, 0, 'a correctly-ordered parent is left exactly alone');
  assert.equal(untouched.get('c').y, 400);
});

test('people outside the visible set are excluded from every structure', () => {
  const g = buildGraph(
    [person('a'), person('b'), person('kid')],
    [partnerEdge('a', 'b'), parentEdge('a', 'kid'), parentEdge('b', 'kid')],
  );
  const s = buildFamilyStructure(g, (id) => id === 'a');
  assert.equal(s.pods.length, 0, 'a pod needs two visible members');
  assert.equal(s.childGroups.length, 0, 'an unrevealed child contributes no group');
});

test('a missing node is skipped rather than throwing', () => {
  const g = buildGraph([person('a'), person('b')], [partnerEdge('a', 'b')]);
  const s = buildFamilyStructure(g, all);
  const nodeById = new Map([['a', { id: 'a', x: 0, y: 0, vx: 0, vy: 0 }]]);
  assert.doesNotThrow(() => applyFamilyForces(s, nodeById, 0.3));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
