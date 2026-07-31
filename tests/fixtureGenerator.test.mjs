/**
 * Unit tests for lib/fixtureGenerator.js — the Phase 0 synthetic-family
 * generator (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md §8.1).
 * These are integrity/determinism checks on the generator itself, not on
 * the perimeter feature (which doesn't exist yet) — the load-bearing
 * property this file protects is "every fixture is a valid tree the real
 * app machinery can safely consume," since a subtly-broken fixture would
 * make every downstream Phase 0 benchmark number meaningless.
 *
 * Run with: node tests/fixtureGenerator.test.mjs
 */
import assert from 'node:assert/strict';
import { generateFamilyFixture, generateCorruptCycleFixture } from '../src/lib/fixtureGenerator.js';
import { buildGraph, distancesFrom } from '../src/data/graph.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const SIZES = [100, 500, 1100, 5000];

// ── Determinism ──────────────────────────────────────────────────────────

test('the same {size, seed} produces byte-identical output', () => {
  const a = generateFamilyFixture({ size: 300, seed: 7 });
  const b = generateFamilyFixture({ size: 300, seed: 7 });
  assert.equal(JSON.stringify(a.tree), JSON.stringify(b.tree));
  assert.deepEqual(a.meta, b.meta);
});

test('a different seed produces a different tree at the same size', () => {
  const a = generateFamilyFixture({ size: 300, seed: 7 });
  const b = generateFamilyFixture({ size: 300, seed: 8 });
  assert.notEqual(JSON.stringify(a.tree), JSON.stringify(b.tree));
});

// ── Structural integrity, every required size ───────────────────────────

for (const size of SIZES) {
  test(`size ${size}: exact person count, no duplicate ids, no dangling relationship references`, () => {
    const { tree } = generateFamilyFixture({ size, seed: 42 });
    assert.equal(tree.people.length, size);
    const ids = new Set(tree.people.map((p) => p.id));
    assert.equal(ids.size, tree.people.length, 'no duplicate person ids');
    for (const r of tree.relationships) {
      assert.ok(ids.has(r.from_person), `relationship ${r.id} references missing from_person ${r.from_person}`);
      assert.ok(ids.has(r.to_person), `relationship ${r.id} references missing to_person ${r.to_person}`);
    }
  });

  test(`size ${size}: no person is both is_living and is_deceased, and every deceased person with a death_date was born first`, () => {
    const { tree } = generateFamilyFixture({ size, seed: 42 });
    for (const p of tree.people) {
      assert.notEqual(p.is_living, p.is_deceased, `${p.id} has is_living === is_deceased`);
      if (p.is_deceased && p.death_date) {
        assert.ok(p.death_date >= p.birth_date, `${p.id} died before being born`);
      }
    }
  });

  test(`size ${size}: guaranteed structural cases are all present`, () => {
    const { tree, meta } = generateFamilyFixture({ size, seed: 42 });
    const byId = new Map(tree.people.map((p) => [p.id, p]));

    // Four-current-partner anchor (the spec's "standard" multi-anchor case).
    assert.ok(meta.fourPartnerAnchorId, 'no four-partner anchor recorded');
    const fourPartners = tree.relationships.filter(
      (r) => r.type === 'partner' && r.partner_status === 'current'
        && (r.from_person === meta.fourPartnerAnchorId || r.to_person === meta.fourPartnerAnchorId),
    );
    assert.equal(fourPartners.length, 4);

    // Eight-anchor stress case, size >= 500 only.
    if (size >= 500) {
      assert.ok(meta.eightPartnerAnchorId, 'no eight-partner anchor recorded for size >= 500');
      const eightPartners = tree.relationships.filter(
        (r) => r.type === 'partner' && r.partner_status === 'current'
          && (r.from_person === meta.eightPartnerAnchorId || r.to_person === meta.eightPartnerAnchorId),
      );
      assert.equal(eightPartners.length, 8);
    } else {
      assert.equal(meta.eightPartnerAnchorId, null);
    }

    // Pedigree collapse: the recorded child has two parent edges from two
    // different people who are not partners-in-a-simple-couple-only —
    // concretely, two distinct parent edges pointing at the same child.
    assert.ok(meta.pedigreeCollapseChildId);
    const collapseParentEdges = tree.relationships.filter((r) => r.type === 'parent' && r.to_person === meta.pedigreeCollapseChildId);
    assert.equal(collapseParentEdges.length, 2);
    assert.notEqual(collapseParentEdges[0].from_person, collapseParentEdges[1].from_person);

    // Explicit step case: one biological + one step parent edge into the same child.
    assert.ok(meta.stepChildId);
    const stepEdges = tree.relationships.filter((r) => r.type === 'parent' && r.to_person === meta.stepChildId);
    assert.equal(stepEdges.length, 2);
    assert.ok(stepEdges.some((e) => e.qualifier === 'step'));
    assert.ok(stepEdges.some((e) => e.qualifier === 'biological'));

    // Explicit adoptive case: both parent edges adoptive.
    assert.ok(meta.adoptiveChildId);
    const adoptEdges = tree.relationships.filter((r) => r.type === 'parent' && r.to_person === meta.adoptiveChildId);
    assert.equal(adoptEdges.length, 2);
    assert.ok(adoptEdges.every((e) => e.qualifier === 'adoptive'));

    // Disconnected people: recorded ids exist, and genuinely have zero
    // relationships of any kind.
    assert.ok(meta.disconnectedIds.length > 0);
    for (const id of meta.disconnectedIds) {
      assert.ok(byId.has(id));
      const touches = tree.relationships.some((r) => r.from_person === id || r.to_person === id);
      assert.equal(touches, false, `${id} was supposed to be disconnected but has a relationship`);
    }
  });

  test(`size ${size}: a mix of rich and sparse profiles exists`, () => {
    const { tree } = generateFamilyFixture({ size, seed: 42 });
    const rich = tree.people.filter((p) => p.bio).length;
    const sparse = tree.people.length - rich;
    assert.ok(rich > 0, 'expected at least one rich profile');
    assert.ok(sparse > 0, 'expected at least one sparse profile');
  });

  test(`size ${size}: buildGraph + distancesFrom run correctly and quickly`, () => {
    const { tree, meta } = generateFamilyFixture({ size, seed: 42 });
    const g = buildGraph(tree.people, tree.relationships);
    const t0 = performance.now();
    const dist = distancesFrom(g, tree.myPersonId);
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 2000, `distancesFrom took ${elapsed.toFixed(1)}ms for ${size} people — investigate before trusting benchmark numbers`);
    // The main connected component reaches meaningfully more than a
    // handful of people (i.e. this isn't accidentally an all-disconnected
    // fixture) but not necessarily everyone — the multi-partner anchor
    // clusters and disconnected pool are deliberately their own islands.
    assert.ok(dist.size > size * 0.15, `only reached ${dist.size} of ${size} from the default viewer`);
    // Deliberately-disconnected people are never reachable from anyone.
    for (const id of meta.disconnectedIds) assert.equal(dist.has(id), false);
  });
}

// ── The corrupt-cycle fixture: proves termination, not scale ───────────────

test('the corrupt-cycle fixture does not hang buildGraph or distancesFrom', () => {
  const { tree, meta } = generateCorruptCycleFixture(1);
  const g = buildGraph(tree.people, tree.relationships);
  const t0 = performance.now();
  const dist = distancesFrom(g, tree.myPersonId);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 500, `distancesFrom on a 6-person corrupt fixture took ${elapsed}ms — likely hung`);
  // The 3-cycle (a -> b -> c -> a) is still mutually reachable — a cycle
  // isn't "no path," just a path that loops; the point is termination.
  for (const id of meta.cycleIds) assert.ok(dist.has(id), `${id} unreachable`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
