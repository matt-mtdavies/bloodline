/**
 * Atlas plates — cutting a too-wide family into plates and packing them.
 *
 * The thing being fixed is measurable, so it is asserted as a measurement:
 * a tidy tree of a growing family is a triangle whose widest generation
 * alone sets the width (308 people in one row at 1,200; 1,414 at 5,000),
 * giving 15:1 and then 50:1 bounding boxes that no camera can frame well.
 * These tests pin that the fix actually fixes it, that it does NOT fire on
 * a family that never had the problem, and that nothing is lost or
 * duplicated in the cutting.
 *
 * Run with: node tests/atlasPlates.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';
import { people as seedPeople, relationships as seedRels } from '../src/data/seed.js';
import { planAtlas } from '../src/viz/atlas/layout.js';
import { packPlates, TRIGGER_ASPECT } from '../src/viz/atlas/plates.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const aspect = (f) => (f.bounds.maxX - f.bounds.minX) / (f.bounds.maxY - f.bounds.minY);

const big = generateFamilyFixture({ size: 1200, seed: 7 }).tree;
const bigGraph = buildGraph(big.people, big.relationships);
const bigFlat = planAtlas(bigGraph, { plates: false });
const bigPlated = planAtlas(bigGraph);

/* ── the packer itself, with no layout engine involved ─────────────────── */

test('packing never overlaps two plates', () => {
  const plates = [
    { id: 'a', w: 100, h: 50, x0: 0, y0: 0 },
    { id: 'b', w: 80, h: 90, x0: 0, y0: 0 },
    { id: 'c', w: 120, h: 40, x0: 0, y0: 0 },
    { id: 'd', w: 60, h: 60, x0: 0, y0: 0 },
  ];
  const { offsets } = packPlates(plates, 200, 10, 10);
  const boxes = plates.map((p) => {
    const o = offsets.get(p.id);
    return { id: p.id, l: o.dx, r: o.dx + p.w, t: o.dy, b: o.dy + p.h };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], z = boxes[j];
      const overlap = a.r > z.l && z.r > a.l && a.b > z.t && z.b > a.t;
      assert.ok(!overlap, `${a.id} overlaps ${z.id}`);
    }
  }
});

test('packing is deterministic and respects the target width', () => {
  const plates = [
    { id: 'a', w: 100, h: 50, x0: 0, y0: 0 },
    { id: 'b', w: 80, h: 90, x0: 0, y0: 0 },
    { id: 'c', w: 120, h: 40, x0: 0, y0: 0 },
  ];
  const one = packPlates(plates, 210, 10, 10);
  const two = packPlates(plates, 210, 10, 10);
  for (const p of plates) assert.deepEqual(one.offsets.get(p.id), two.offsets.get(p.id));
  // No single shelf may exceed the target once more than one plate is on it.
  assert.ok(one.width <= 210 + 1e-6, `packed width ${one.width} exceeds target`);
});

test('a plate keeps its own internal layout — it is only ever translated', () => {
  const plates = [{ id: 'a', w: 100, h: 50, x0: -30, y0: -20 }];
  const { offsets } = packPlates(plates, 500, 10, 10);
  // The offset must move the plate's own top-left to the origin, nothing more.
  assert.equal(offsets.get('a').dx, 30);
  assert.equal(offsets.get('a').dy, 20);
});

/* ── the pass end to end ───────────────────────────────────────────────── */

test('a family that is not too wide is left completely alone', () => {
  const seed = buildGraph(seedPeople, seedRels);
  const f = planAtlas(seed);
  assert.ok(aspect(f) <= TRIGGER_ASPECT, `the demo family is ${aspect(f).toFixed(1)}:1, which should not trigger plating`);
  assert.equal(f.stats.plates, undefined, 'the demo family must not be cut into plates');
  assert.equal(f.eras.length, f.stats.generations, 'and it keeps its era axis');
});

test('a 15:1 family is cut into plates and comes out the shape of a screen', () => {
  assert.ok(aspect(bigFlat) > 10, `flat should be very wide, got ${aspect(bigFlat).toFixed(1)}:1`);
  assert.ok(aspect(bigPlated) < 2.5, `plated should be screen-shaped, got ${aspect(bigPlated).toFixed(2)}:1`);
  assert.ok(bigPlated.stats.plates >= 2);
  console.log(`      1,200 people: ${aspect(bigFlat).toFixed(1)}:1 → ${aspect(bigPlated).toFixed(2)}:1 across ${bigPlated.stats.plates} plates`);
});

test('nobody is lost, duplicated, or left off a plate', () => {
  assert.equal(bigPlated.nodes.size, big.people.length);
  const seen = new Set();
  for (const b of bigPlated.branches) {
    for (const m of b.memberIds) {
      assert.ok(!seen.has(m), `${m} is on two plates`);
      seen.add(m);
    }
  }
  assert.equal(seen.size, big.people.length, 'every person belongs to exactly one plate');
  for (const [, n] of bigPlated.nodes) assert.ok(n.plate, 'every node carries its plate');
});

test('every plate can be named, so every region on the map can be labelled', () => {
  for (const b of bigPlated.branches) {
    assert.ok(b.surname, `plate ${b.id} has no name`);
    assert.ok(b.bands.length, `plate ${b.id} has no bands to draw`);
    assert.ok(b.people > 0);
  }
});

test('cross-plate links are a small minority, and are tagged so the map can hold them back', () => {
  const descents = bigPlated.bonds.filter((b) => b.kind === 'descent');
  const cross = descents.filter((b) => b.crossPlate);
  assert.ok(cross.length > 0, 'cutting a family necessarily severs some links');
  const share = cross.length / descents.length;
  assert.ok(share < 0.15, `${(share * 100).toFixed(1)}% of links span plates — too many to hold back quietly`);
  // Every one of them must still name only real parents of that child.
  const byId = new Map(bigPlated.units.map((u) => [u.id, u]));
  const rel = new Set(big.relationships.filter((r) => r.type === 'parent').map((r) => `${r.from_person}|${r.to_person}`));
  for (const b of cross) {
    const u = byId.get(b.parentUnit);
    assert.ok(u, `cross-plate link to ${b.child} names a missing unit`);
    const ids = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
    assert.ok(ids.length, `cross-plate link to ${b.child} reaches nobody`);
    for (const p of ids) assert.ok(rel.has(`${p}|${b.child}`), `drew ${p} as a parent of ${b.child} with no such edge`);
  }
  console.log(`      ${cross.length} of ${descents.length} connectors span plates (${(share * 100).toFixed(1)}%)`);
});

test('the 5,000-person target also comes out screen-shaped, and still in reasonable time', () => {
  const t = generateFamilyFixture({ size: 5000, seed: 7 }).tree;
  const started = Date.now();
  const f = planAtlas(buildGraph(t.people, t.relationships));
  const ms = Date.now() - started;
  assert.equal(f.nodes.size, 5000);
  assert.ok(aspect(f) < 2.5, `got ${aspect(f).toFixed(2)}:1`);
  assert.ok(ms < 4000, `layout took ${ms}ms`);
  console.log(`      5,000 people: → ${aspect(f).toFixed(2)}:1 across ${f.stats.plates} plates in ${ms}ms`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
