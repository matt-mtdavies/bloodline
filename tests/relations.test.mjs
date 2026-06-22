/**
 * Unit tests for graph.js — sibling classification, relation labels, extended
 * family propagation, and edge cases. Run with: node tests/relations.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, relationLabel, distancesFrom, pathBetween } from '../src/data/graph.js';

// ── helpers ──────────────────────────────────────────────────────────────────

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

const person = (id, gender = null, extra = {}) => ({
  id,
  display_name: id,
  gender,
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

// ── 1. Sibling classification ─────────────────────────────────────────────────

test('full siblings — share 2 bio parents', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'),  parentEdge('mum', 'bob'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'full');
});

test('half siblings — share exactly 1 bio parent', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum1', 'female'), person('mum2', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum1', 'alice'),
      parentEdge('dad', 'bob'),  parentEdge('mum2', 'bob'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'half');
});

test('step siblings — share only a step-parent', () => {
  // alice's bio dad is married to bob's bio mum; alice is bio of dad, bob is bio of mum.
  // dad is STEP parent to bob; mum is STEP parent to alice.
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad', 'alice', 'biological'),
      parentEdge('mum', 'alice', 'step'),      // mum is alice's step-parent
      parentEdge('mum', 'bob',  'biological'),
      parentEdge('dad', 'bob',  'step'),       // dad is bob's step-parent
      partnerEdge('dad', 'mum'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'step', `expected step, got ${sib?.kind}`);
});

test('step siblings — child of step-parent only', () => {
  // alice's only parents are bio mum. stepDad has bio son bob. stepDad = alice's step-dad.
  const g = buildGraph(
    [person('mum', 'female'), person('stepdad', 'male'), person('alice'), person('bob')],
    [
      parentEdge('mum',     'alice', 'biological'),
      parentEdge('stepdad', 'alice', 'step'),
      parentEdge('stepdad', 'bob',  'biological'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'step');
});

test('adoptive full siblings — 2 shared adoptive parents → full', () => {
  const g = buildGraph(
    [person('adad', 'male'), person('amum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('adad', 'alice', 'adoptive'), parentEdge('amum', 'alice', 'adoptive'),
      parentEdge('adad', 'bob',  'adoptive'), parentEdge('amum', 'bob',  'adoptive'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'full');
});

test('bio + adoptive parent mix — 2 shared counts as full', () => {
  // alice has bio dad + adoptive mum. bob has same bio dad + same adoptive mum.
  const g = buildGraph(
    [person('dad', 'male'), person('amum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad',  'alice', 'biological'), parentEdge('amum', 'alice', 'adoptive'),
      parentEdge('dad',  'bob',  'biological'), parentEdge('amum', 'bob',  'adoptive'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'full');
});

test('bio parent + step-parent: shared bio one → half, not step', () => {
  // alice: bio dad, bio mum. bob: bio dad, step mum (same mum). They share bio dad only.
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad', 'alice', 'biological'), parentEdge('mum', 'alice', 'biological'),
      parentEdge('dad', 'bob',  'biological'), parentEdge('mum', 'bob',  'step'),
    ],
  );
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  assert.equal(sib?.kind, 'half');
});

test('sibling symmetry — alice→bob same kind as bob→alice', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bob')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bob'),  parentEdge('mum', 'bob'),
    ],
  );
  const ab = g.siblings('alice').find((s) => s.id === 'bob')?.kind;
  const ba = g.siblings('bob').find((s) => s.id === 'alice')?.kind;
  assert.equal(ab, ba);
});

test('no parents → no siblings', () => {
  const g = buildGraph(
    [person('alice'), person('bob')],
    [],
  );
  assert.equal(g.siblings('alice').length, 0);
});

// ── 2. relationLabel — 1-hop ──────────────────────────────────────────────────

test('self → You', () => {
  const g = buildGraph([person('alice')], []);
  assert.equal(relationLabel(g, 'alice', 'alice'), 'You');
});

test('current partner → Partner', () => {
  const g = buildGraph([person('alice'), person('bob', 'male')], [partnerEdge('alice', 'bob')]);
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Partner');
});

test('former partner → Former partner', () => {
  const g = buildGraph([person('alice'), person('bob')], [partnerEdge('alice', 'bob', 'former')]);
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Former partner');
});

test('widowed partner → Late partner', () => {
  const g = buildGraph([person('alice'), person('bob')], [partnerEdge('alice', 'bob', 'widowed')]);
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Late partner');
});

test('bio father → Father', () => {
  const g = buildGraph([person('alice'), person('dad', 'male')], [parentEdge('dad', 'alice')]);
  assert.equal(relationLabel(g, 'alice', 'dad'), 'Father');
});

test('bio mother → Mother', () => {
  const g = buildGraph([person('alice'), person('mum', 'female')], [parentEdge('mum', 'alice')]);
  assert.equal(relationLabel(g, 'alice', 'mum'), 'Mother');
});

test('bio parent unknown gender → Parent', () => {
  const g = buildGraph([person('alice'), person('par')], [parentEdge('par', 'alice')]);
  assert.equal(relationLabel(g, 'alice', 'par'), 'Parent');
});

test('step father → Step Father', () => {
  const g = buildGraph([person('alice'), person('sdad', 'male')], [parentEdge('sdad', 'alice', 'step')]);
  assert.equal(relationLabel(g, 'alice', 'sdad'), 'Step Father');
});

test('adoptive mother → Adoptive Mother', () => {
  const g = buildGraph([person('alice'), person('amum', 'female')], [parentEdge('amum', 'alice', 'adoptive')]);
  assert.equal(relationLabel(g, 'alice', 'amum'), 'Adoptive Mother');
});

test('bio son → Son', () => {
  const g = buildGraph([person('alice'), person('kid', 'male')], [parentEdge('alice', 'kid')]);
  assert.equal(relationLabel(g, 'alice', 'kid'), 'Son');
});

test('bio daughter → Daughter', () => {
  const g = buildGraph([person('alice'), person('kid', 'female')], [parentEdge('alice', 'kid')]);
  assert.equal(relationLabel(g, 'alice', 'kid'), 'Daughter');
});

test('step son → Step Son', () => {
  const g = buildGraph([person('alice'), person('kid', 'male')], [parentEdge('alice', 'kid', 'step')]);
  assert.equal(relationLabel(g, 'alice', 'kid'), 'Step Son');
});

test('adoptive daughter → Adoptive Daughter', () => {
  const g = buildGraph([person('alice'), person('kid', 'female')], [parentEdge('alice', 'kid', 'adoptive')]);
  assert.equal(relationLabel(g, 'alice', 'kid'), 'Adoptive Daughter');
});

test('full brother → Brother', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bob', 'male')],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice'), parentEdge('dad', 'bob'), parentEdge('mum', 'bob')],
  );
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Brother');
});

test('full sister → Sister', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('sis', 'female')],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice'), parentEdge('dad', 'sis'), parentEdge('mum', 'sis')],
  );
  assert.equal(relationLabel(g, 'alice', 'sis'), 'Sister');
});

test('half-brother → Half-Brother', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum1', 'female'), person('mum2', 'female'), person('alice'), person('bob', 'male')],
    [parentEdge('dad', 'alice'), parentEdge('mum1', 'alice'), parentEdge('dad', 'bob'), parentEdge('mum2', 'bob')],
  );
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Half-Brother');
});

test('step-sister → Step-Sister', () => {
  const g = buildGraph(
    [person('mum', 'female'), person('stepdad', 'male'), person('alice'), person('sis', 'female')],
    [
      parentEdge('mum',     'alice', 'biological'),
      parentEdge('stepdad', 'alice', 'step'),
      parentEdge('stepdad', 'sis',  'biological'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'sis'), 'Step-Sister');
});

test('sibling with no kind (legacy data) → no prefix', () => {
  // Simulate a graph where siblings have kind=undefined (old stored data).
  const g = buildGraph(
    [person('dad', 'male'), person('alice'), person('bob', 'male')],
    [parentEdge('dad', 'alice'), parentEdge('dad', 'bob')],
  );
  // Manually mutate to simulate missing kind field.
  const sib = g.siblings('alice').find((s) => s.id === 'bob');
  if (sib) sib.kind = undefined;
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Brother');
});

// ── 3. relationLabel — 2-hop: grandparents ────────────────────────────────────

test('paternal grandfather → Paternal Grandfather', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('dad', 'male'), person('alice')],
    [parentEdge('gdad', 'dad'), parentEdge('dad', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'gdad'), 'Paternal Grandfather');
});

test('paternal grandmother → Paternal Grandmother', () => {
  const g = buildGraph(
    [person('gmum', 'female'), person('dad', 'male'), person('alice')],
    [parentEdge('gmum', 'dad'), parentEdge('dad', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'gmum'), 'Paternal Grandmother');
});

test('maternal grandfather → Maternal Grandfather', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('mum', 'female'), person('alice')],
    [parentEdge('gdad', 'mum'), parentEdge('mum', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'gdad'), 'Maternal Grandfather');
});

test('maternal grandmother → Maternal Grandmother', () => {
  const g = buildGraph(
    [person('gmum', 'female'), person('mum', 'female'), person('alice')],
    [parentEdge('gmum', 'mum'), parentEdge('mum', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'gmum'), 'Maternal Grandmother');
});

test('bio parent unknown gender → no side prefix → Grandparent', () => {
  const g = buildGraph(
    [person('gpar'), person('par'), person('alice')],
    [parentEdge('gpar', 'par'), parentEdge('par', 'alice')],
  );
  // par has no gender → side is null → prefix ''
  assert.equal(relationLabel(g, 'alice', 'gpar'), 'Grandparent');
});

test('step-parent\'s parent → Step Grandparent (not Paternal)', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('stepdad', 'male'), person('alice')],
    [parentEdge('gdad', 'stepdad'), parentEdge('stepdad', 'alice', 'step')],
  );
  assert.equal(relationLabel(g, 'alice', 'gdad'), 'Step Grandparent');
});

test('adoptive parent\'s parent → Adoptive Grandparent', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('adad', 'male'), person('alice')],
    [parentEdge('gdad', 'adad'), parentEdge('adad', 'alice', 'adoptive')],
  );
  assert.equal(relationLabel(g, 'alice', 'gdad'), 'Adoptive Grandparent');
});

// ── 4. relationLabel — 2-hop: grandchildren ───────────────────────────────────

test('grandson → Grandson', () => {
  const g = buildGraph(
    [person('alice'), person('son', 'male'), person('gs', 'male')],
    [parentEdge('alice', 'son'), parentEdge('son', 'gs')],
  );
  assert.equal(relationLabel(g, 'alice', 'gs'), 'Grandson');
});

test('granddaughter → Granddaughter', () => {
  const g = buildGraph(
    [person('alice'), person('dau', 'female'), person('gd', 'female')],
    [parentEdge('alice', 'dau'), parentEdge('dau', 'gd')],
  );
  assert.equal(relationLabel(g, 'alice', 'gd'), 'Granddaughter');
});

test('grandchild unknown gender → Grandchild', () => {
  const g = buildGraph(
    [person('alice'), person('son', 'male'), person('gc')],
    [parentEdge('alice', 'son'), parentEdge('son', 'gc')],
  );
  assert.equal(relationLabel(g, 'alice', 'gc'), 'Grandchild');
});

// ── 5. relationLabel — 3-hop: great-grandparents / great-grandchildren ────────

test('great-grandfather → Great-grandfather', () => {
  const g = buildGraph(
    [person('ggdad', 'male'), person('gdad', 'male'), person('dad', 'male'), person('alice')],
    [parentEdge('ggdad', 'gdad'), parentEdge('gdad', 'dad'), parentEdge('dad', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'ggdad'), 'Great-grandfather');
});

test('great-granddaughter → Great-granddaughter', () => {
  const g = buildGraph(
    [person('alice'), person('dau', 'female'), person('gdau', 'female'), person('ggdau', 'female')],
    [parentEdge('alice', 'dau'), parentEdge('dau', 'gdau'), parentEdge('gdau', 'ggdau')],
  );
  assert.equal(relationLabel(g, 'alice', 'ggdau'), 'Great-granddaughter');
});

test('great-grandson → Great-grandson', () => {
  const g = buildGraph(
    [person('alice'), person('son', 'male'), person('gs', 'male'), person('ggs', 'male')],
    [parentEdge('alice', 'son'), parentEdge('son', 'gs'), parentEdge('gs', 'ggs')],
  );
  assert.equal(relationLabel(g, 'alice', 'ggs'), 'Great-grandson');
});

// ── 6. relationLabel — aunts and uncles ───────────────────────────────────────

test('paternal uncle (bio dad\'s brother) → Paternal Uncle', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('dad', 'male'), person('uncle', 'male'), person('alice')],
    [
      parentEdge('gdad', 'dad'), parentEdge('gmum', 'dad'),
      parentEdge('gdad', 'uncle'), parentEdge('gmum', 'uncle'),
      parentEdge('dad', 'alice'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'uncle'), 'Paternal Uncle');
});

test('maternal aunt (bio mum\'s sister) → Maternal Aunt', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('mum', 'female'), person('aunt', 'female'), person('alice')],
    [
      parentEdge('gdad', 'mum'), parentEdge('gmum', 'mum'),
      parentEdge('gdad', 'aunt'), parentEdge('gmum', 'aunt'),
      parentEdge('mum', 'alice'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'aunt'), 'Maternal Aunt');
});

test('step-parent\'s sibling → Step Uncle', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('stepdad', 'male'), person('uncle', 'male'), person('alice')],
    [
      parentEdge('gdad', 'stepdad'), parentEdge('gmum', 'stepdad'),
      parentEdge('gdad', 'uncle'),   parentEdge('gmum', 'uncle'),
      parentEdge('stepdad', 'alice', 'step'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'uncle'), 'Step Uncle');
});

test('adoptive parent\'s sibling → Adoptive Aunt', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('adad', 'male'), person('aunt', 'female'), person('alice')],
    [
      parentEdge('gdad', 'adad'), parentEdge('gmum', 'adad'),
      parentEdge('gdad', 'aunt'), parentEdge('gmum', 'aunt'),
      parentEdge('adad', 'alice', 'adoptive'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'aunt'), 'Adoptive Aunt');
});

test('uncle by marriage (bio dad\'s brother\'s partner) → Paternal Uncle (by marriage)', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('dad', 'male'), person('dadbro', 'male'), person('uncle', 'male'), person('alice')],
    [
      parentEdge('gdad', 'dad'), parentEdge('gmum', 'dad'),
      parentEdge('gdad', 'dadbro'), parentEdge('gmum', 'dadbro'),
      parentEdge('dad', 'alice'),
      partnerEdge('dadbro', 'uncle'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'uncle'), 'Paternal Uncle (by marriage)');
});

// ── 7. relationLabel — nieces, nephews, cousins ───────────────────────────────

test('nephew (brother\'s son) → Nephew', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bro', 'male'), person('nephew', 'male')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bro'),   parentEdge('mum', 'bro'),
      parentEdge('bro', 'nephew'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'nephew'), 'Nephew');
});

test('niece (sister\'s daughter) → Niece', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('sis', 'female'), person('niece', 'female')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'sis'),   parentEdge('mum', 'sis'),
      parentEdge('sis', 'niece'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'niece'), 'Niece');
});

test('cousin (bio dad\'s sibling\'s child) → Cousin', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('dad', 'male'), person('uncle', 'male'), person('alice'), person('cousin')],
    [
      parentEdge('gdad', 'dad'), parentEdge('gmum', 'dad'),
      parentEdge('gdad', 'uncle'), parentEdge('gmum', 'uncle'),
      parentEdge('dad', 'alice'),
      parentEdge('uncle', 'cousin'),
    ],
  );
  assert.equal(relationLabel(g, 'alice', 'cousin'), 'Cousin');
});

test('unrelated person → Relative', () => {
  const g = buildGraph([person('alice'), person('stranger')], []);
  assert.equal(relationLabel(g, 'alice', 'stranger'), 'Relative');
});

// ── 8. Extended family propagation rules ─────────────────────────────────────
// (Tests the upwardParents filter by simulating what PersonSheet/AccessibleTree do.)

function extendedFamilyOf(g, focusId) {
  const parents = g.parents(focusId);
  const children = g.children(focusId);
  const siblings = g.siblings(focusId);

  const immediateIds = new Set([
    focusId,
    ...g.partners(focusId).map((x) => x.id),
    ...parents.map((x) => x.id),
    ...children.map((x) => x.id),
    ...siblings.map((x) => x.id),
  ]);
  const extSeen = new Set();
  const ext = (items) => {
    const out = [];
    for (const item of items) {
      if (!immediateIds.has(item.id) && !extSeen.has(item.id)) {
        extSeen.add(item.id);
        out.push(item.id);
      }
    }
    return out;
  };

  const upwardParents = parents.filter(
    (p) => !p.qualifier || p.qualifier === 'biological' || p.qualifier === 'adoptive',
  );

  return {
    grandparents: ext(upwardParents.flatMap((p) => g.parents(p.id).map((gp) => ({ id: gp.id })))),
    auntsUncles:  ext(upwardParents.flatMap((p) => g.siblings(p.id).map((s) => ({ id: s.id })))),
    grandchildren: ext(children.flatMap((c) => g.children(c.id).map((gc) => ({ id: gc.id })))),
    niecesNephews: ext(siblings.flatMap((s) => g.children(s.id).map((c) => ({ id: c.id })))),
  };
}

test('bio parent propagates grandparent', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('dad', 'male'), person('alice')],
    [parentEdge('gdad', 'dad'), parentEdge('dad', 'alice')],
  );
  const ext = extendedFamilyOf(g, 'alice');
  assert.ok(ext.grandparents.includes('gdad'));
});

test('adoptive parent propagates grandparent', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('adad', 'male'), person('alice')],
    [parentEdge('gdad', 'adad'), parentEdge('adad', 'alice', 'adoptive')],
  );
  const ext = extendedFamilyOf(g, 'alice');
  assert.ok(ext.grandparents.includes('gdad'));
});

test('step-parent does NOT propagate grandparent', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('stepdad', 'male'), person('alice')],
    [parentEdge('gdad', 'stepdad'), parentEdge('stepdad', 'alice', 'step')],
  );
  const ext = extendedFamilyOf(g, 'alice');
  assert.ok(!ext.grandparents.includes('gdad'));
});

test('bio parent propagates aunt/uncle', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('dad', 'male'), person('aunt', 'female'), person('alice')],
    [
      parentEdge('gdad', 'dad'), parentEdge('gmum', 'dad'),
      parentEdge('gdad', 'aunt'), parentEdge('gmum', 'aunt'),
      parentEdge('dad', 'alice'),
    ],
  );
  const ext = extendedFamilyOf(g, 'alice');
  assert.ok(ext.auntsUncles.includes('aunt'));
});

test('step-parent does NOT propagate aunt/uncle', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('stepdad', 'male'), person('aunt', 'female'), person('alice')],
    [
      parentEdge('gdad', 'stepdad'), parentEdge('gmum', 'stepdad'),
      parentEdge('gdad', 'aunt'),    parentEdge('gmum', 'aunt'),
      parentEdge('stepdad', 'alice', 'step'),
    ],
  );
  const ext = extendedFamilyOf(g, 'alice');
  assert.ok(!ext.auntsUncles.includes('aunt'));
});

test('no person appears in two extended groups', () => {
  // uncle is also a child of a grandchild (weird but possible to test dedup)
  const g = buildGraph(
    [person('gdad', 'male'), person('gmum', 'female'), person('dad', 'male'), person('uncle', 'male'), person('son', 'male'), person('alice')],
    [
      parentEdge('gdad', 'dad'), parentEdge('gmum', 'dad'),
      parentEdge('gdad', 'uncle'), parentEdge('gmum', 'uncle'),
      parentEdge('dad', 'alice'),
      parentEdge('alice', 'son'),
      // make 'uncle' appear as both an aunt/uncle AND a grandchild (contrived)
      parentEdge('son', 'uncle'), // uncle IS also alice's son's child (circular/weird)
    ],
  );
  const ext = extendedFamilyOf(g, 'alice');
  const allExt = [...ext.grandparents, ...ext.auntsUncles, ...ext.grandchildren, ...ext.niecesNephews];
  const ids = allExt.filter((id) => id !== undefined);
  const unique = new Set(ids);
  assert.equal(ids.length, unique.size, 'duplicate found in extended groups');
});

test('immediate family excluded from extended groups', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('bro', 'male'), person('kid')],
    [
      parentEdge('dad', 'alice'), parentEdge('mum', 'alice'),
      parentEdge('dad', 'bro'),   parentEdge('mum', 'bro'),
      parentEdge('alice', 'kid'),
    ],
  );
  const ext = extendedFamilyOf(g, 'alice');
  const allExt = [...ext.grandparents, ...ext.auntsUncles, ...ext.grandchildren, ...ext.niecesNephews];
  assert.ok(!allExt.includes('dad'));
  assert.ok(!allExt.includes('mum'));
  assert.ok(!allExt.includes('bro'));
  assert.ok(!allExt.includes('kid'));
  assert.ok(!allExt.includes('alice'));
});

// ── 9. BFS utilities ──────────────────────────────────────────────────────────

test('distancesFrom: self = 0, parent = 1, grandparent = 2', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('dad', 'male'), person('alice')],
    [parentEdge('gdad', 'dad'), parentEdge('dad', 'alice')],
  );
  const d = distancesFrom(g, 'alice');
  assert.equal(d.get('alice'), 0);
  assert.equal(d.get('dad'), 1);
  assert.equal(d.get('gdad'), 2);
});

test('distancesFrom: disconnected person not in map', () => {
  const g = buildGraph([person('alice'), person('stranger')], []);
  const d = distancesFrom(g, 'alice');
  assert.ok(!d.has('stranger'));
});

test('pathBetween: self returns singleton set', () => {
  const g = buildGraph([person('alice')], []);
  const path = pathBetween(g, 'alice', 'alice');
  assert.deepEqual([...path], ['alice']);
});

test('pathBetween: no path returns null', () => {
  const g = buildGraph([person('alice'), person('bob')], []);
  assert.equal(pathBetween(g, 'alice', 'bob'), null);
});

test('pathBetween: parent→grandchild path contains all three', () => {
  const g = buildGraph(
    [person('gdad', 'male'), person('dad', 'male'), person('alice')],
    [parentEdge('gdad', 'dad'), parentEdge('dad', 'alice')],
  );
  const path = pathBetween(g, 'gdad', 'alice');
  assert.ok(path.has('gdad'));
  assert.ok(path.has('dad'));
  assert.ok(path.has('alice'));
});

// ── 10. Edge cases ────────────────────────────────────────────────────────────

test('empty graph builds without error', () => {
  const g = buildGraph([], []);
  assert.equal(g.people.length, 0);
});

test('partner with missing status → Partner', () => {
  const g = buildGraph(
    [person('alice'), person('bob')],
    [{ type: 'partner', from_person: 'alice', to_person: 'bob', qualifier: 'biological' }], // no partner_status
  );
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Partner');
});

test('gender capitalisation variants all work — Male/MALE/male', () => {
  for (const gender of ['male', 'Male', 'MALE']) {
    const g = buildGraph([person('alice'), person('bob', gender)], [partnerEdge('alice', 'bob')]);
    // Partner doesn't use gender for label, but check it doesn't throw
    assert.doesNotThrow(() => relationLabel(g, 'alice', 'bob'));
  }
});

test('person with no gender gets neutral sibling label', () => {
  // Full siblings (2 shared parents) where sib has no gender → should be 'Sibling'
  const g = buildGraph(
    [person('dad', 'male'), person('mum', 'female'), person('alice'), person('sib')], // sib has no gender
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice'), parentEdge('dad', 'sib'), parentEdge('mum', 'sib')],
  );
  assert.equal(relationLabel(g, 'alice', 'sib'), 'Sibling');
});

test('niece/nephew from step-sibling appears (step siblings are still siblings)', () => {
  const g = buildGraph(
    [person('mum', 'female'), person('stepdad', 'male'), person('alice'), person('stepbro', 'male'), person('kid', 'female')],
    [
      parentEdge('mum',     'alice',   'biological'),
      parentEdge('stepdad', 'alice',   'step'),
      parentEdge('stepdad', 'stepbro', 'biological'),
      parentEdge('stepbro', 'kid'),
    ],
  );
  // stepbro IS alice's step-sibling; kid IS stepbro's daughter → Niece label
  assert.equal(relationLabel(g, 'alice', 'kid'), 'Niece');
});

test('partner is bidirectional', () => {
  const g = buildGraph(
    [person('alice'), person('bob')],
    [partnerEdge('alice', 'bob')],
  );
  assert.equal(relationLabel(g, 'alice', 'bob'), 'Partner');
  assert.equal(relationLabel(g, 'bob', 'alice'), 'Partner');
});

test('parent relationship is directional — parent sees child as Child not Parent', () => {
  const g = buildGraph(
    [person('dad', 'male'), person('alice')],
    [parentEdge('dad', 'alice')],
  );
  assert.equal(relationLabel(g, 'alice', 'dad'), 'Father');
  assert.equal(relationLabel(g, 'dad', 'alice'), 'Child'); // alice has no gender
});

test('three-generation chain: alice→son→grandson labels from alice\'s view', () => {
  const g = buildGraph(
    [person('alice'), person('son', 'male'), person('gs', 'male')],
    [parentEdge('alice', 'son'), parentEdge('son', 'gs')],
  );
  assert.equal(relationLabel(g, 'alice', 'son'), 'Son');
  assert.equal(relationLabel(g, 'alice', 'gs'),  'Grandson');
  assert.equal(relationLabel(g, 'son',   'alice'), 'Parent'); // alice has no gender
  assert.equal(relationLabel(g, 'gs',    'alice'), 'Paternal Grandparent'); // son is male → paternal side; alice has no gender → Grandparent not Grandfather
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n── Bloodline relationship logic tests ─────────────────────────\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.error ? `\n      → ${r.error}` : ''}`);
}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
