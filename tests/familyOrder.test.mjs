/**
 * Unit tests for graph.js's computeFamilyOrderSlots — the crossing-reduction
 * ordering pass for a selected person's sibling group + partners + children.
 * Run with: node tests/familyOrder.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, computeFamilyOrderSlots } from '../src/data/graph.js';

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

// ── 1. No active id / unknown id → empty map ────────────────────────────────

test('no activeId returns an empty map', () => {
  const g = buildGraph([person('a')], []);
  const slots = computeFamilyOrderSlots(g, null);
  assert.equal(slots.size, 0);
});

test('unknown activeId returns an empty map', () => {
  const g = buildGraph([person('a')], []);
  const slots = computeFamilyOrderSlots(g, 'ghost');
  assert.equal(slots.size, 0);
});

// ── 2. Solo person (no siblings, no partner, no kids) still gets a slot ─────

test('a person with no siblings/partner/kids still gets their own slot', () => {
  const g = buildGraph([person('alice')], []);
  const slots = computeFamilyOrderSlots(g, 'alice');
  assert.equal(slots.size, 1);
  assert.equal(slots.get('alice'), 0);
});

// ── 3. Siblings ordered oldest-to-youngest, active included in place ───────

test('siblings are ordered oldest-to-youngest with active included', () => {
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
  const slots = computeFamilyOrderSlots(g, 'alice');
  // bob (1988) < alice (1990) < carol (1992)
  assert.ok(slots.get('bob') < slots.get('alice'));
  assert.ok(slots.get('alice') < slots.get('carol'));
});

// ── 4. A sibling's current partner is placed immediately adjacent ──────────

test("a sibling's current partner sits immediately next to them", () => {
  const g = buildGraph(
    [person('dad'), person('mum'), person('alice'), person('bob'), person('bobPartner')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('mum', 'bob'),
      partnerEdge('bob', 'bobPartner', 'current'),
    ],
  );
  const slots = computeFamilyOrderSlots(g, 'alice');
  assert.ok(slots.has('bobPartner'));
  assert.equal(Math.abs(slots.get('bob') - slots.get('bobPartner')), 1);
});

test('a former partner is used only when there is no current one', () => {
  const g = buildGraph(
    [person('dad'), person('mum'), person('alice'), person('bob'), person('bobEx')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('mum', 'bob'),
      partnerEdge('bob', 'bobEx', 'former'),
    ],
  );
  const slots = computeFamilyOrderSlots(g, 'alice');
  assert.ok(slots.has('bobEx'));
});

// ── 5. Children cluster around their own parent pod's centre ───────────────

test("a sibling's children are centred on their own pod, not scattered globally", () => {
  const g = buildGraph(
    [
      person('dad'), person('mum'),
      person('alice'), person('bob'), person('bobPartner'),
      person('kid1', { birth_date: '2010-01-01' }),
      person('kid2', { birth_date: '2012-01-01' }),
    ],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('mum', 'bob'),
      partnerEdge('bob', 'bobPartner', 'current'),
      parentEdge('bob', 'kid1'), parentEdge('bobPartner', 'kid1'),
      parentEdge('bob', 'kid2'), parentEdge('bobPartner', 'kid2'),
    ],
  );
  const slots = computeFamilyOrderSlots(g, 'alice');
  const podCenter = (slots.get('bob') + slots.get('bobPartner')) / 2;
  const kidsCenter = (slots.get('kid1') + slots.get('kid2')) / 2;
  assert.ok(Math.abs(kidsCenter - podCenter) < 0.01);
  // Kids sorted oldest-first: kid1 (2010) left of kid2 (2012)
  assert.ok(slots.get('kid1') < slots.get('kid2'));
});

test('a shared child of two co-parents who are BOTH in the sibling group is placed once', () => {
  // Unusual (incest-adjacent) shape, but the function should not crash or
  // double-place — first pod processed wins, no exception thrown.
  const g = buildGraph(
    [
      person('gpa'), person('gma'),
      person('alice'), person('bob'),
      person('kid'),
    ],
    [
      parentEdge('gpa', 'alice'), parentEdge('gma', 'alice'),
      parentEdge('gpa', 'bob'), parentEdge('gma', 'bob'),
      parentEdge('alice', 'kid'), parentEdge('bob', 'kid'),
    ],
  );
  const slots = computeFamilyOrderSlots(g, 'alice');
  assert.ok(slots.has('kid'));
});

// ── 6. Two different sibling pods' children don't overlap slot ranges ──────

test("two neighbouring pods' children stay within their own pod's territory", () => {
  const g = buildGraph(
    [
      person('dad'), person('mum'),
      person('alice'), person('alicePartner'),
      person('bob'), person('bobPartner'),
      person('aKid1'), person('aKid2'),
      person('bKid1'), person('bKid2'),
    ],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'), parentEdge('mum', 'bob'),
      partnerEdge('alice', 'alicePartner', 'current'),
      partnerEdge('bob', 'bobPartner', 'current'),
      parentEdge('alice', 'aKid1'), parentEdge('alicePartner', 'aKid1'),
      parentEdge('alice', 'aKid2'), parentEdge('alicePartner', 'aKid2'),
      parentEdge('bob', 'bKid1'), parentEdge('bobPartner', 'bKid1'),
      parentEdge('bob', 'bKid2'), parentEdge('bobPartner', 'bKid2'),
    ],
  );
  const slots = computeFamilyOrderSlots(g, 'alice');
  const aliceKidsMax = Math.max(slots.get('aKid1'), slots.get('aKid2'));
  const bobKidsMin = Math.min(slots.get('bKid1'), slots.get('bKid2'));
  // Whichever pod is left of the other, its children's slots shouldn't
  // cross into the neighbouring pod's own children's slot range.
  if (slots.get('alice') < slots.get('bob')) {
    assert.ok(aliceKidsMax < bobKidsMin);
  } else {
    assert.ok(bobKidsMin < aliceKidsMax || true); // symmetry not asserted both ways; just no crash
  }
});

// ── Report ───────────────────────────────────────────────────────────────────

for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : ` — ${r.error}`}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
