/**
 * Unit tests for graph.js#computeGenerations — the row-assignment pass
 * BubbleTree's organic layout builds its Y-bands from. Real user reports:
 * "the parents are not consistently higher than their children" and "the
 * partner pod needs to be level." Root cause was that partner-levelling and
 * the parent-above-child cascade correction ran as two separate one-shot
 * passes: a cascade adjustment could deepen someone whose OWN partner was
 * levelled earlier against that person's now-stale, shallower value, leaving
 * the partner stuck on the wrong row with no invariant left to fix it.
 *
 * Extended for a second real report, on a 600+ person tree spanning
 * 1573-2025 with wildly uneven documented depth across branches: "her
 * siblings sit at the same level as her kids." Siblings only ever ended up
 * level as a SIDE EFFECT of both cascading below the same shared parent —
 * which breaks the moment one sibling partners into a far more deeply-
 * documented branch and gets pulled many rows deeper by partner-levelling,
 * with nothing pulling their un-partnered siblings down to match.
 * Sibling-levelling (any kind — full/half/step) is now a third explicit
 * invariant, levelled the same "only ever move deeper, take the max" way as
 * partners.
 *
 * Previously had ZERO test coverage despite being load-bearing for both
 * complaints — every test here is new. Run with: node tests/computeGenerations.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, computeGenerations } from '../src/data/graph.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, ...extra });
const par = (from, to, qualifier = 'biological') => ({ type: 'parent', from_person: from, to_person: to, qualifier, partner_status: null });
const ptn = (a, b, status = 'current') => ({ type: 'partner', from_person: a, to_person: b, partner_status: status });

// Every parent must be strictly above (smaller gen than) every one of their
// children, every CURRENT partner pair must share the same gen, and every
// sibling pair (any kind) must share the same gen.
function assertInvariants(graph, gen, label) {
  for (const child of graph.people) {
    for (const parent of graph.parents(child.id)) {
      const pg = gen.get(parent.id), cg = gen.get(child.id);
      assert.ok(pg < cg, `${label}: parent ${parent.id} (gen ${pg}) must be above child ${child.id} (gen ${cg})`);
    }
  }
  const seen = new Set();
  for (const p of graph.people) {
    for (const partner of graph.partners(p.id)) {
      if (partner.status === 'former') continue;
      const key = [p.id, partner.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      assert.equal(gen.get(p.id), gen.get(partner.id),
        `${label}: current partners ${p.id} (gen ${gen.get(p.id)}) and ${partner.id} (gen ${gen.get(partner.id)}) must be level`);
    }
  }
  const seenSib = new Set();
  for (const p of graph.people) {
    for (const sib of graph.siblings(p.id)) {
      const key = [p.id, sib.id].sort().join('|');
      if (seenSib.has(key)) continue;
      seenSib.add(key);
      assert.equal(gen.get(p.id), gen.get(sib.id),
        `${label}: siblings ${p.id} (gen ${gen.get(p.id)}) and ${sib.id} (gen ${gen.get(sib.id)}) must be level`);
    }
  }
}

test('a plain nuclear family: parents above children, partners level', () => {
  const graph = buildGraph(
    [person('dad'), person('mum'), person('kid1'), person('kid2')],
    [ptn('dad', 'mum'), par('dad', 'kid1'), par('mum', 'kid1'), par('dad', 'kid2'), par('mum', 'kid2')],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'nuclear');
  assert.equal(gen.get('dad'), 0);
  assert.equal(gen.get('kid1'), 1);
});

test('the exact reported bug: a partner levelled deeper by their OWN separate ancestry leaves their child\'s partner stuck on the wrong row', () => {
  // GQ -> Q (Q's own ancestry, one generation deeper than P's side).
  // P partners Q (current) -> P should level DOWN to match Q.
  // P -> K (P's child) -> K must cascade below P's new, deeper row.
  // K partners R (current, no ancestry of their own) -> R must level to
  // match K's FINAL row, not K's original (pre-cascade) one.
  const graph = buildGraph(
    [person('GQ'), person('Q'), person('P'), person('K'), person('R')],
    [par('GQ', 'Q'), par('P', 'K'), ptn('P', 'Q'), ptn('K', 'R')],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'reported bug');
  assert.equal(gen.get('K'), gen.get('R'), 'K and R must end up level');
  assert.equal(gen.get('P'), gen.get('Q'), 'P and Q must end up level');
});

test('the same bug, one generation deeper: a grandchild whose parents were BOTH deepened by a cascade still lands strictly below them', () => {
  const graph = buildGraph(
    [person('GQ'), person('Q'), person('P'), person('K'), person('R'), person('GC')],
    [par('GQ', 'Q'), par('P', 'K'), par('K', 'GC'), par('R', 'GC'), ptn('P', 'Q'), ptn('K', 'R')],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'deep cascade');
  assert.equal(gen.get('K'), gen.get('R'));
  assert.ok(gen.get('GC') > gen.get('K'));
  assert.ok(gen.get('GC') > gen.get('R'));
});

test('a long chain of unequal ancestry pulled level at every generation', () => {
  // A five-generation chain on one side, a shallow single person on the
  // other at every level, each pair partnered — every level must still
  // converge to fully level partners and correctly ordered rows.
  const people = [];
  const relationships = [];
  people.push(person('a0'));
  for (let i = 1; i <= 4; i++) {
    people.push(person(`a${i}`));
    relationships.push(par(`a${i - 1}`, `a${i}`));
    people.push(person(`b${i}`)); // shallow partner, no ancestry of their own
    relationships.push(ptn(`a${i}`, `b${i}`));
  }
  const graph = buildGraph(people, relationships);
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'long chain');
  for (let i = 1; i <= 4; i++) {
    assert.equal(gen.get(`a${i}`), gen.get(`b${i}`), `a${i}/b${i} must be level`);
  }
});

test('former partners are still excluded from levelling — an ex with deeper ancestry does not drag the family member down', () => {
  const graph = buildGraph(
    [person('gp1'), person('gp2'), person('exDeep'), person('me')],
    [par('gp1', 'exDeep'), par('gp2', 'exDeep'), ptn('me', 'exDeep', 'former')],
  );
  const gen = computeGenerations(graph);
  // 'me' has no ancestry of their own and no CURRENT partner, so should stay
  // at the root row rather than being pulled down to exDeep's deeper row.
  assert.equal(gen.get('me'), 0);
  assert.equal(gen.get('exDeep'), 1);
});

test('a three-way partner chain (A=B, B=C) still converges to one level, transitively', () => {
  const graph = buildGraph(
    [person('deepAncestor'), person('A'), person('B'), person('C')],
    [par('deepAncestor', 'A'), ptn('A', 'B'), ptn('B', 'C')],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'partner chain');
  assert.equal(gen.get('A'), gen.get('B'));
  assert.equal(gen.get('B'), gen.get('C'));
});

test('a blended family with two independently-deepened co-parent lines both cascade and level correctly', () => {
  // Two separate couples (P1/Q1 and P2/Q2), each with the same shape as the
  // reported bug, sharing no one — both must resolve independently and
  // correctly in the SAME computeGenerations call.
  const graph = buildGraph(
    [
      person('GQ1'), person('Q1'), person('P1'), person('K1'), person('R1'),
      person('GQ2'), person('Q2'), person('P2'), person('K2'), person('R2'),
    ],
    [
      par('GQ1', 'Q1'), par('P1', 'K1'), ptn('P1', 'Q1'), ptn('K1', 'R1'),
      par('GQ2', 'Q2'), par('P2', 'K2'), ptn('P2', 'Q2'), ptn('K2', 'R2'),
    ],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'two independent blended lines');
  assert.equal(gen.get('K1'), gen.get('R1'));
  assert.equal(gen.get('K2'), gen.get('R2'));
});

test('the new reported bug: a sibling pulled deep by their OWN partner\'s ancestry no longer strands their un-partnered sibling on the shallow row', () => {
  // F has two children, D and S (full siblings, both biological). D partners
  // DP, whose own separate ancestry (GP1->GP2->GP3->GP4->DP) is far deeper
  // than F's side. D's own child K exists too. Before sibling-levelling: D
  // (and DP) get pulled down to DP's deep row by partner-levelling, K
  // cascades one below D's new row — but S, never partnered to anyone,
  // stays at F's original shallow row, landing S at or near K's row instead
  // of D's. That's the exact real report: "her siblings sit at the same
  // level as her kids."
  const graph = buildGraph(
    [
      person('F'), person('D'), person('S'), person('K'),
      person('GP1'), person('GP2'), person('GP3'), person('GP4'), person('DP'),
    ],
    [
      par('F', 'D'), par('F', 'S'), par('D', 'K'), ptn('D', 'DP'),
      par('GP1', 'GP2'), par('GP2', 'GP3'), par('GP3', 'GP4'), par('GP4', 'DP'),
    ],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'sibling stranded by partner depth');
  assert.equal(gen.get('D'), gen.get('S'), 'D and S must be level (siblings)');
  assert.ok(gen.get('S') < gen.get('K'), 'S must still sit strictly above D\'s child K');
});

test('sibling-levelling converges transitively across three full siblings when only one partners deep', () => {
  const graph = buildGraph(
    [
      person('F'), person('D'), person('S1'), person('S2'),
      person('GP1'), person('GP2'), person('GP3'), person('DP'),
    ],
    [
      par('F', 'D'), par('F', 'S1'), par('F', 'S2'), ptn('D', 'DP'),
      par('GP1', 'GP2'), par('GP2', 'GP3'), par('GP3', 'DP'),
    ],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'three siblings, one pulled deep');
  assert.equal(gen.get('D'), gen.get('S1'));
  assert.equal(gen.get('D'), gen.get('S2'));
});

test('half- and step-siblings level the same way as full siblings', () => {
  // Mum1 and Mum2 both partner Dad; Half is Dad+Mum2's child (half-sibling
  // of Dad+Mum1's child Full, sharing only Dad); StepKid is Mum2's own child
  // from a prior relationship (no shared biological/adoptive parent with
  // Full at all — connected only through the step edge to Dad). Dad's line
  // is deepened via a separate partner with deep ancestry of their own.
  const graph = buildGraph(
    [
      person('Dad'), person('Mum1'), person('Mum2'), person('Full'), person('Half'), person('StepKid'),
      person('GP1'), person('GP2'), person('GP3'), person('DeepPartner'),
    ],
    [
      par('Dad', 'Full', 'biological'), par('Mum1', 'Full', 'biological'),
      par('Dad', 'Half', 'biological'), par('Mum2', 'Half', 'biological'),
      par('Dad', 'StepKid', 'step'),
      ptn('Full', 'DeepPartner'),
      par('GP1', 'GP2'), par('GP2', 'GP3'), par('GP3', 'DeepPartner'),
    ],
  );
  const gen = computeGenerations(graph);
  assertInvariants(graph, gen, 'half and step siblings');
  assert.equal(gen.get('Full'), gen.get('Half'), 'half-siblings must be level');
  assert.equal(gen.get('Full'), gen.get('StepKid'), 'step-siblings must be level');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
