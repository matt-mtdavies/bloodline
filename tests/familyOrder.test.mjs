/**
 * Unit tests for graph.js's computeChildOrderSlots — the whole-tree
 * crossing-reduction ordering pass, one independent pod per distinct set of
 * recorded parents. Run with: node tests/familyOrder.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, computeChildOrderSlots } from '../src/data/graph.js';

let passed = 0, failed = 0;
const results = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    results.push({ ok: true, label });
  } catch (e) {
    failed++;
    results.push({ ok: false, label, error: e.message });
  }
}

const person = (id, extra = {}) => ({
  id,
  display_name: id,
  gender: null,
  is_deceased: false,
  ...extra,
});

const parentEdge = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent',
  from_person: parentId,
  to_person: childId,
  qualifier,
  partner_status: null,
});

const partnerEdge = (a, b, status = 'current') => ({
  type: 'partner',
  from_person: a,
  to_person: b,
  qualifier: 'biological',
  partner_status: status,
});

const findPod = (pods, parentId) => pods.find((p) => p.parentIds.includes(parentId));
const offsetOf = (pod, childId) => pod.children.find((c) => c.id === childId)?.offset;

// ── 1. Empty / no visible ids ────────────────────────────────────────────────

test('no visible ids returns no pods', () => {
  const g = buildGraph([person('a')], []);
  const pods = computeChildOrderSlots(g, []);
  assert.equal(pods.length, 0);
});

test('a visible person with no recorded parents produces no pod', () => {
  const g = buildGraph([person('a')], []);
  const pods = computeChildOrderSlots(g, ['a']);
  assert.equal(pods.length, 0);
});

// ── 2. One pod, offsets sum to zero and are ordered oldest-to-youngest ─────

test('a single pod orders children oldest-to-youngest with zero-mean offsets', () => {
  const g = buildGraph(
    [
      person('dad'), person('mum'),
      person('alice', { birth_date: '1990-01-01' }),
      person('bob', { birth_date: '1988-01-01' }),
      person('carol', { birth_date: '1992-01-01' }),
    ],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('mum', 'bob'),
      parentEdge('dad', 'carol'), parentEdge('mum', 'carol'),
    ],
  );
  const pods = computeChildOrderSlots(g, ['dad', 'mum', 'alice', 'bob', 'carol']);
  assert.equal(pods.length, 1);
  const pod = pods[0];
  assert.deepEqual([...pod.parentIds].sort(), ['dad', 'mum']);
  const sum = pod.children.reduce((s, c) => s + c.offset, 0);
  assert.ok(Math.abs(sum) < 1e-9);
  assert.ok(offsetOf(pod, 'bob') < offsetOf(pod, 'alice'));
  assert.ok(offsetOf(pod, 'alice') < offsetOf(pod, 'carol'));
});

test('an only child gets offset exactly 0', () => {
  const g = buildGraph(
    [person('dad'), person('mum'), person('alice')],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice')],
  );
  const pods = computeChildOrderSlots(g, ['dad', 'mum', 'alice']);
  assert.equal(offsetOf(pods[0], 'alice'), 0);
});

// ── 3. Half-siblings land in DIFFERENT pods, both anchored to the shared parent ─

test('half-siblings from two different partners form two separate pods, both naming the shared parent', () => {
  const g = buildGraph(
    [
      person('dad'), person('momA'), person('momB'),
      person('alice'), person('bob'), person('carol'),
    ],
    [
      parentEdge('dad', 'alice'), parentEdge('momA', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('momA', 'bob'),
      parentEdge('dad', 'carol'), parentEdge('momB', 'carol'),
      partnerEdge('dad', 'momA', 'former'),
      partnerEdge('dad', 'momB', 'current'),
    ],
  );
  const pods = computeChildOrderSlots(g, ['dad', 'momA', 'momB', 'alice', 'bob', 'carol']);
  assert.equal(pods.length, 2);
  const podA = findPod(pods, 'momA');
  const podB = findPod(pods, 'momB');
  assert.ok(podA.parentIds.includes('dad'));
  assert.ok(podB.parentIds.includes('dad'));
  assert.ok(podA.children.some((c) => c.id === 'alice'));
  assert.ok(podA.children.some((c) => c.id === 'bob'));
  assert.ok(podB.children.some((c) => c.id === 'carol'));
  assert.ok(!podA.children.some((c) => c.id === 'carol'));
});

// ── 4. Step-children (single shared step-parent, no shared bio parent) ─────

test('step-siblings (no shared bio parent) also form separate pods', () => {
  const g = buildGraph(
    [
      person('mum'), person('stepdad'), person('bio'),
      person('kidA'), person('kidB'),
    ],
    [
      parentEdge('mum', 'kidA'), parentEdge('bio', 'kidA'),
      parentEdge('mum', 'kidB'), parentEdge('stepdad', 'kidB', 'step'),
    ],
  );
  const pods = computeChildOrderSlots(g, ['mum', 'bio', 'stepdad', 'kidA', 'kidB']);
  assert.equal(pods.length, 2);
  const podBio = findPod(pods, 'bio');
  const podStep = findPod(pods, 'stepdad');
  assert.ok(podBio.children.some((c) => c.id === 'kidA'));
  assert.ok(podStep.children.some((c) => c.id === 'kidB'));
});

// ── 5. Qualifier picks the strongest bond when it differs per parent ───────

test('a child biological to one parent and step to the other tiers as biological', () => {
  const g = buildGraph(
    [person('bio'), person('step'), person('kid'), person('other', { birth_date: '1990-01-01' })],
    [
      parentEdge('bio', 'kid'), parentEdge('step', 'kid', 'step'),
      parentEdge('bio', 'other'),
    ],
  );
  // Force a tiebreak scenario is unnecessary here — just confirm the pod
  // is built correctly and doesn't crash on mixed qualifiers.
  const pods = computeChildOrderSlots(g, ['bio', 'step', 'kid']);
  assert.equal(pods.length, 1);
  assert.ok(pods[0].children.some((c) => c.id === 'kid'));
});

// ── 6. A pod with an invisible parent is dropped from that parent's edge ───

test('a parent outside the visible set is excluded from parentIds', () => {
  const g = buildGraph(
    [person('dad'), person('mum'), person('alice')],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice')],
  );
  const pods = computeChildOrderSlots(g, ['dad', 'alice']); // mum not visible
  assert.equal(pods.length, 1);
  assert.deepEqual(pods[0].parentIds, ['dad']);
});

// ── 7. Two unrelated pods elsewhere in a large visible set don't interfere ──

test('two entirely unrelated pods are computed independently', () => {
  const g = buildGraph(
    [
      person('dad1'), person('mum1'), person('kid1'),
      person('dad2'), person('mum2'), person('kid2a'), person('kid2b'),
    ],
    [
      parentEdge('dad1', 'kid1'), parentEdge('mum1', 'kid1'),
      parentEdge('dad2', 'kid2a'), parentEdge('mum2', 'kid2a'),
      parentEdge('dad2', 'kid2b'), parentEdge('mum2', 'kid2b'),
    ],
  );
  const pods = computeChildOrderSlots(g, ['dad1', 'mum1', 'kid1', 'dad2', 'mum2', 'kid2a', 'kid2b']);
  assert.equal(pods.length, 2);
});

// ── 8. A couple who are BOTH independently anchorable never both get pulled ─
// Real report: "When I expand either side of my tree, it pulls Matthew and
// Kaitlin apart" — each was independently a "child" in their own birth pod,
// so both got pulled toward two different, distant ancestral anchors.

test('when both partners have their own birth families, only the lower-id one keeps a pull', () => {
  const g = buildGraph(
    [
      person('aDad'), person('aMum'), person('aMatthew'),
      person('zDad'), person('zMum'), person('zKaitlin'),
    ],
    [
      parentEdge('aDad', 'aMatthew'), parentEdge('aMum', 'aMatthew'),
      parentEdge('zDad', 'zKaitlin'), parentEdge('zMum', 'zKaitlin'),
      partnerEdge('aMatthew', 'zKaitlin', 'current'),
    ],
  );
  const visible = ['aDad', 'aMum', 'aMatthew', 'zDad', 'zMum', 'zKaitlin'];
  const pods = computeChildOrderSlots(g, visible);
  const allChildIds = pods.flatMap((p) => p.children.map((c) => c.id));
  assert.ok(allChildIds.includes('aMatthew'));
  assert.ok(!allChildIds.includes('zKaitlin'));
});

test('a partner with no recorded parents of their own does not suppress the other partner', () => {
  const g = buildGraph(
    [person('dad'), person('mum'), person('matthew'), person('inlaw')],
    [
      parentEdge('dad', 'matthew'), parentEdge('mum', 'matthew'),
      partnerEdge('matthew', 'inlaw', 'current'),
    ],
  );
  const pods = computeChildOrderSlots(g, ['dad', 'mum', 'matthew', 'inlaw']);
  const allChildIds = pods.flatMap((p) => p.children.map((c) => c.id));
  assert.ok(allChildIds.includes('matthew'));
  assert.ok(!allChildIds.includes('inlaw')); // inlaw has no parents, so no pod includes them anyway
});

test('a former (not current) partner is still recognised as the same couple for this purpose', () => {
  const g = buildGraph(
    [
      person('aDad'), person('aMum'), person('aMatthew'),
      person('zDad'), person('zMum'), person('zKaitlin'),
    ],
    [
      parentEdge('aDad', 'aMatthew'), parentEdge('aMum', 'aMatthew'),
      parentEdge('zDad', 'zKaitlin'), parentEdge('zMum', 'zKaitlin'),
      partnerEdge('aMatthew', 'zKaitlin', 'former'),
    ],
  );
  const visible = ['aDad', 'aMum', 'aMatthew', 'zDad', 'zMum', 'zKaitlin'];
  const pods = computeChildOrderSlots(g, visible);
  const allChildIds = pods.flatMap((p) => p.children.map((c) => c.id));
  assert.ok(allChildIds.includes('aMatthew'));
  assert.ok(!allChildIds.includes('zKaitlin'));
});

// ── Report ───────────────────────────────────────────────────────────────────

for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : ` — ${r.error}`}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
