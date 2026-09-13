/**
 * Unit tests for src/viz/pedigreeLayout.js's cross-axis overlap avoidance.
 *
 * Real production bug, reported with a screenshot from a 478-person family:
 * ancestor cards overlapping badly in Chart view. Root-caused to `span()`/
 * `place()` tracking one SYMMETRIC half-width per card, while the placement
 * itself anchors each branch to its own member's plate and pushes the two
 * branches apart by an ASYMMETRIC amount (the wider branch absorbs nearly
 * all of the push — deliberate, see the comment in pedigreeLayout.js). Once
 * that push is asymmetric, a card's true rendered extent from its own
 * centre is no longer symmetric either, so a single `span/2` radius
 * UNDERESTIMATES the wide side — proven with a worked example: a
 * 2000-unit-wide branch beside a 224-unit one computed a claimed span/2 of
 * 1132, but the wide branch's true left edge sat 1939.5 units out. Anything
 * further up the tree that relied on the undersized span to keep ITS OWN
 * siblings apart then had too little room, and two unrelated "cousin"
 * branches (one parent's ancestry vs the other parent's) collided several
 * generations up — exactly the reported shape, and reproducible ONLY with
 * genuinely asymmetric branch depths (a symmetric demo-scale tree never hit
 * it, which is why it shipped unnoticed). Fixed by tracking separate
 * left/right extents per card instead of one symmetric radius.
 *
 * Run with: node tests/pedigreeLayout.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computePedigree } from '../src/viz/pedigreeLayout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function p(from, to, qualifier = 'biological') {
  return { id: `r_${from}_${to}`, from_person: from, to_person: to, type: 'parent', qualifier, partner_status: null };
}
function partner(a, b, status) {
  return { id: `r_${a}_${b}`, from_person: a, to_person: b, type: 'partner', qualifier: 'biological', partner_status: status, is_married: false, marriage_date: null, marriage_place: null };
}
function person(id, gender = 'male') {
  return { id, display_name: id, given_names: id, family_name: '', gender, is_living: false, is_deceased: true, confidence: 'confirmed' };
}

// Deterministic PRNG (mulberry32) — seeded, so a failure is always
// reproducible from its printed seed, never a flaky one-off.
function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Builds a messy, asymmetric ancestor tree above two named roots: each
// generation, ~soloProb of ancestors have only ONE recorded parent (a real,
// common genealogy gap), and ~stopProb of branches stop early (uneven depth
// per lineage) — the shape that actually triggers the bug, unlike a clean,
// fully-symmetric tree.
function genAncestors(people, relationships, rootA, rootB, generations, branchPrefix, rngSeed, counter) {
  const rng = mulberry(rngSeed);
  let frontier = [[rootA, true], [rootB, true]];
  for (let g = 0; g < generations; g++) {
    const next = [];
    for (const [id] of frontier) {
      const soloParent = rng() < counter.soloProb;
      const pa = `${branchPrefix}_${g}_${id}_pa`;
      counter.n++;
      people.push(person(pa, counter.n % 2 === 0 ? 'male' : 'female'));
      relationships.push(p(pa, id));
      if (!soloParent) {
        const pb = `${branchPrefix}_${g}_${id}_pb`;
        counter.n++;
        people.push(person(pb, counter.n % 2 === 0 ? 'male' : 'female'));
        relationships.push(p(pb, id), partner(pa, pb, 'widowed'));
        next.push([pa, true], [pb, true]);
      } else {
        next.push([pa, false]);
      }
    }
    frontier = next.filter(() => rng() > counter.stopProb);
  }
}

function baseFamily() {
  const people = [
    person('james'), person('rachel', 'female'),
    person('robert'), person('linda', 'female'),
    person('arthur'), person('margaret', 'female'),
    person('thomas'), person('eleanor', 'female'),
  ];
  const relationships = [
    p('robert', 'james'), p('linda', 'james'),
    p('arthur', 'robert'), p('margaret', 'robert'),
    p('thomas', 'linda'), p('eleanor', 'linda'),
    partner('robert', 'linda', 'current'),
    partner('arthur', 'margaret', 'widowed'),
    partner('thomas', 'eleanor', 'widowed'),
    partner('james', 'rachel', 'former'),
  ];
  return { people, relationships };
}

// Every pair of cards' rectangles (centre x/y, full w/h) must not overlap by
// more than a hairline (a shared border/seam is fine; real overlap isn't).
function findOverlaps(cards) {
  const overlaps = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      const overlapX = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
      const overlapY = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
      if (overlapX > 1 && overlapY > 1) overlaps.push({ a: a.id, b: b.id, overlapX, overlapY });
    }
  }
  return overlaps;
}

test('a small, clean, symmetric ancestor tree never overlaps (pre-existing behavior, unaffected)', () => {
  const { people, relationships } = baseFamily();
  const graph = buildGraph(people, relationships);
  const expandedUp = new Set(people.map((p) => p.id));
  const result = computePedigree(graph, 'james', { expandedUp, partnerChoice: new Map(), orientation: 'vertical', bloodlineOnly: false });
  assert.equal(findOverlaps(result.cards).length, 0);
});

test('the exact reported bug: one deep, wide branch beside one shallow/unexpanded branch', () => {
  // Robert's line (Arthur+Margaret) goes 6 generations deep and wide;
  // Linda's line (Thomas+Eleanor) stays shallow (2 generations) — a highly
  // asymmetric pair of siblings under the same card, the shape that a
  // single symmetric `span/2` mis-measures.
  const { people, relationships } = baseFamily();
  const counter = { n: 0, soloProb: 0, stopProb: 0 };
  genAncestors(people, relationships, 'arthur', 'margaret', 6, 'deep', 42, counter);
  genAncestors(people, relationships, 'thomas', 'eleanor', 2, 'shallow', 43, counter);
  const graph = buildGraph(people, relationships);
  const expandedUp = new Set(people.map((p) => p.id));
  const result = computePedigree(graph, 'james', { expandedUp, partnerChoice: new Map(), orientation: 'vertical', bloodlineOnly: false });
  const overlaps = findOverlaps(result.cards);
  assert.equal(overlaps.length, 0, `found overlaps: ${JSON.stringify(overlaps)}`);
});

test('randomized sweep: many asymmetric, incompletely-recorded ancestor trees never overlap', () => {
  const failures = [];
  let runs = 0;
  for (let seedBase = 1; seedBase <= 30; seedBase += 3) {
    for (const soloProb of [0.15, 0.35, 0.55]) {
      for (const stopProb of [0.1, 0.25, 0.45]) {
        const { people, relationships } = baseFamily();
        const counter = { n: 0, soloProb, stopProb };
        genAncestors(people, relationships, 'arthur', 'margaret', 8, 'am', seedBase * 100 + 1, counter);
        genAncestors(people, relationships, 'thomas', 'eleanor', 8, 'te', seedBase * 100 + 2, counter);
        const graph = buildGraph(people, relationships);
        const expandedUp = new Set(people.map((p) => p.id));
        const result = computePedigree(graph, 'james', { expandedUp, partnerChoice: new Map(), orientation: 'vertical', bloodlineOnly: false });
        const overlaps = findOverlaps(result.cards);
        runs++;
        if (overlaps.length) failures.push({ seedBase, soloProb, stopProb, count: overlaps.length });
      }
    }
  }
  assert.equal(failures.length, 0, `${failures.length}/${runs} configurations produced overlaps: ${JSON.stringify(failures)}`);
});

test('landscape orientation also never overlaps under the same asymmetric shape', () => {
  const { people, relationships } = baseFamily();
  const counter = { n: 0, soloProb: 0.3, stopProb: 0.2 };
  genAncestors(people, relationships, 'arthur', 'margaret', 6, 'lam', 777, counter);
  genAncestors(people, relationships, 'thomas', 'eleanor', 6, 'lte', 888, counter);
  const graph = buildGraph(people, relationships);
  const expandedUp = new Set(people.map((p) => p.id));
  const result = computePedigree(graph, 'james', { expandedUp, partnerChoice: new Map(), orientation: 'horizontal', bloodlineOnly: false });
  const overlaps = findOverlaps(result.cards);
  assert.equal(overlaps.length, 0, `found overlaps: ${JSON.stringify(overlaps)}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
