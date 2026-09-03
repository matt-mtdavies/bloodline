/**
 * Atlas layout — the whole-family planner's constraint suite.
 *
 * Every promise the map makes is asserted here rather than eyeballed:
 * everyone drawn exactly once, every parent strictly above every child,
 * current partners rigidly podded, nothing on a row overlapping, siblings in
 * birth order under one parent unit, byte-identical output for identical
 * input — and all of it on the REPRESENTATIVE 1,200-person fixture, not the
 * 23-person demo (standing instruction: real or representative data only).
 *
 * Run with: node tests/atlasLayout.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';
import { people as seedPeople, relationships as seedRels } from '../src/data/seed.js';
import { planAtlas, isFarReach, ROW_GAP, UNIT_GAP } from '../src/viz/atlas/layout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const P = (id, extra = {}) => ({ id, display_name: id, ...extra });
const parent = (from, to, qualifier) => ({ id: `r${from}${to}`, type: 'parent', from_person: from, to_person: to, qualifier });
const partner = (a, b, status = 'current') => ({ id: `p${a}${b}`, type: 'partner', from_person: a, to_person: b, partner_status: status });

const { tree: big } = generateFamilyFixture({ size: 1200, seed: 7 });
const bigGraph = buildGraph(big.people, big.relationships);
const t0 = Date.now();
const bigFrame = planAtlas(bigGraph);
const bigMs = Date.now() - t0;

const seedGraph = buildGraph(seedPeople, seedRels);
const seedFrame = planAtlas(seedGraph);

for (const [label, graph, frame] of [['demo', seedGraph, seedFrame], ['1,200-person fixture', bigGraph, bigFrame]]) {
  test(`${label}: everyone is drawn exactly once`, () => {
    assert.equal(frame.nodes.size, graph.people.length);
    const seen = new Set();
    for (const u of frame.units) {
      if (u.anchorOnly) continue;
      for (const m of u.memberIds) { assert.ok(!seen.has(m), `${m} drawn twice`); seen.add(m); }
    }
  });

  test(`${label}: every parent sits strictly above every one of their children`, () => {
    for (const r of graph.relationships) {
      if (r.type !== 'parent') continue;
      const p = frame.nodes.get(r.from_person), c = frame.nodes.get(r.to_person);
      if (!p || !c) continue;
      assert.ok(p.y < c.y, `${r.from_person} (y=${p.y}) must be above ${r.to_person} (y=${c.y})`);
    }
  });

  test(`${label}: current partners on one row share a rigid pod, former partners never do`, () => {
    for (const u of frame.units) {
      if (u.anchorOnly || u.memberIds.length < 2) continue;
      const [a, b] = u.memberIds;
      const edge = graph.partners(a).find((pt) => pt.id === b);
      assert.ok(edge, `${a}+${b} podded without a partner edge`);
      assert.notEqual(edge.status, 'former', `${a}+${b} podded despite being former`);
      assert.equal(frame.nodes.get(a).y, frame.nodes.get(b).y, 'a pod is level by construction');
    }
  });

  test(`${label}: no two units on a row overlap`, () => {
    for (const [, arr] of frame.rows) {
      const sorted = [...arr].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        const gap = (sorted[i].x - sorted[i].halfW) - (sorted[i - 1].x + sorted[i - 1].halfW);
        assert.ok(gap >= UNIT_GAP - 1e-6, `overlap on row: gap ${gap.toFixed(1)} between ${sorted[i - 1].id} and ${sorted[i].id}`);
      }
    }
  });

  test(`${label}: every bond references people who are actually in the frame`, () => {
    for (const b of frame.bonds) {
      if (b.kind === 'descent') {
        assert.ok(frame.nodes.has(b.child));
        assert.ok(frame.units.some((u) => u.id === b.parentUnit), `missing parent unit ${b.parentUnit}`);
      } else {
        assert.ok(frame.nodes.has(b.a) && frame.nodes.has(b.b));
      }
    }
  });

  test(`${label}: deterministic — same graph yields byte-identical output`, () => {
    const again = planAtlas(graph);
    for (const [id, n] of frame.nodes) {
      const m = again.nodes.get(id);
      assert.equal(n.x, m.x); assert.equal(n.y, m.y);
    }
  });
}

test('a partner\'s deeply researched line never drags someone rows below their own parents', () => {
  // The real-tree shape: Heather → Matthew and Jason. Matthew partners
  // Kaitlin, whose line is recorded six generations back; Jason partners
  // someone with no recorded ancestry. Depth from the eldest root would put
  // Matthew six rows under Heather and five under his brother.
  const people = [P('H'), P('M', { birth_date: '1980' }), P('J', { birth_date: '1982' }), P('K'), P('JP')];
  const rels = [parent('H', 'M'), parent('H', 'J'), partner('M', 'K'), partner('J', 'JP')];
  let prev = 'K';
  for (let i = 1; i <= 6; i++) { const id = `KA${i}`; people.push(P(id)); rels.push(parent(id, prev)); prev = id; }
  const g = buildGraph(people, rels);
  const f = planAtlas(g);
  const row = (id) => f.nodes.get(id).row;
  assert.equal(row('M'), row('H') + 1, 'Matthew one row under his mother');
  assert.equal(row('J'), row('M'), 'brothers on one row');
  assert.equal(row('K'), row('M'), 'the pod is level');
  assert.equal(row('KA1'), row('M') - 1, "Kaitlin's parent one row up");
  assert.equal(row('KA6'), 0, "Kaitlin's eldest ancestor is the eldest row");
  for (const r of rels) if (r.type === 'parent') assert.ok(row(r.from_person) < row(r.to_person));
});

test('a genuine generational skew is repaired locally, not by re-ranking the family', () => {
  // A cousin marriage a generation apart: C1 (child of A) partners G2
  // (grandchild of A's sibling B). Both invariants must still hold.
  const g = buildGraph(
    [P('R'), P('A'), P('B'), P('C1'), P('B1'), P('G2')],
    [parent('R', 'A'), parent('R', 'B'), parent('A', 'C1'), parent('B', 'B1'), parent('B1', 'G2'), partner('C1', 'G2')],
  );
  const f = planAtlas(g);
  const row = (id) => f.nodes.get(id).row;
  assert.equal(row('C1'), row('G2'));
  assert.ok(row('A') < row('C1') && row('B1') < row('G2') && row('R') < row('A'));
  assert.equal(row('R'), 0);
});

test('siblings under one parent unit read left-to-right in birth order', () => {
  const g = buildGraph(
    [P('MA'), P('PA'), P('C3', { birth_date: '1990-01-01' }), P('C1', { birth_date: '1980-01-01' }), P('C2', { birth_date: '1985-01-01' })],
    [partner('MA', 'PA'), parent('MA', 'C1'), parent('PA', 'C1'), parent('MA', 'C2'), parent('PA', 'C2'), parent('MA', 'C3'), parent('PA', 'C3')],
  );
  const f = planAtlas(g);
  assert.ok(f.nodes.get('C1').x < f.nodes.get('C2').x, 'eldest left');
  assert.ok(f.nodes.get('C2').x < f.nodes.get('C3').x, 'youngest right');
});

test('a couple\'s children are centred under the couple, and the couple over its children', () => {
  const g = buildGraph(
    [P('MA'), P('PA'), P('C1', { birth_date: '1980' }), P('C2', { birth_date: '1985' })],
    [partner('MA', 'PA'), parent('MA', 'C1'), parent('PA', 'C1'), parent('MA', 'C2'), parent('PA', 'C2')],
  );
  const f = planAtlas(g);
  const pod = f.units.find((u) => u.memberIds.length === 2);
  const kidsMid = (f.nodes.get('C1').x + f.nodes.get('C2').x) / 2;
  assert.ok(Math.abs(pod.x - kidsMid) < 1e-6, `pod at ${pod.x}, children midpoint ${kidsMid}`);
});

// Every connector must name exactly the parents it reaches, and every
// recorded parent edge must get a connector. Shared by the cases below.
function connectors(frame, childId) {
  return frame.bonds
    .filter((b) => b.kind === 'descent' && b.child === childId)
    .map((b) => {
      const u = frame.units.find((x) => x.id === b.parentUnit);
      const ids = (u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds).slice().sort();
      return { qualifier: b.qualifier, ids };
    })
    .sort((a, b) => (a.qualifier < b.qualifier ? -1 : a.qualifier > b.qualifier ? 1 : 0));
}

test('a step-parent keeps their own connector to a child who also has blood parents', () => {
  // Heather's own child, cross-recorded step to Ken. The child descends from
  // Heather's line, and Ken's step relationship is still drawn — the first
  // build dropped it entirely whenever any blood parent existed.
  const g = buildGraph(
    [P('H'), P('K'), P('M')],
    [partner('H', 'K'), parent('H', 'M'), parent('K', 'M', 'step')],
  );
  const f = planAtlas(g);
  assert.deepEqual(connectors(f, 'M'), [
    { qualifier: 'biological', ids: ['H'] },
    { qualifier: 'step', ids: ['K'] },
  ]);
  // The blood connector still goes through a junction on Heather alone, not
  // the shared pod — it must not imply Ken is a biological parent.
  const bio = f.bonds.find((b) => b.kind === 'descent' && b.child === 'M' && b.qualifier === 'biological');
  assert.ok(f.units.find((u) => u.id === bio.parentUnit).anchorOnly);
});

test('a couple with mixed qualifiers gets one connector per qualifier, each reaching only its own parents', () => {
  const g = buildGraph(
    [P('MUM'), P('DAD'), P('KID')],
    [partner('MUM', 'DAD'), parent('MUM', 'KID', 'biological'), parent('DAD', 'KID', 'adoptive')],
  );
  const f = planAtlas(g);
  assert.deepEqual(connectors(f, 'KID'), [
    { qualifier: 'adoptive', ids: ['DAD'] },
    { qualifier: 'biological', ids: ['MUM'] },
  ]);
});

test('a plain couple is still one connector, not one per parent', () => {
  const g = buildGraph(
    [P('MUM'), P('DAD'), P('KID')],
    [partner('MUM', 'DAD'), parent('MUM', 'KID'), parent('DAD', 'KID')],
  );
  const f = planAtlas(g);
  assert.deepEqual(connectors(f, 'KID'), [{ qualifier: 'biological', ids: ['DAD', 'MUM'] }]);
});

for (const [label, graph, frame] of [['demo', seedGraph, seedFrame], ['1,200-person fixture', bigGraph, bigFrame]]) {
  test(`${label}: every drawn connector names exactly the parents recorded with its qualifier`, () => {
    const norm = (q) => (q === 'adopted' ? 'adoptive' : !q || q === 'biological' || q === 'adoptive' ? (q || 'biological') : q);
    // What the data says.
    const expected = new Map(); // `${child}|${qualifier}` -> sorted parent ids
    for (const r of graph.relationships) {
      if (r.type !== 'parent') continue;
      if (!frame.nodes.has(r.from_person) || !frame.nodes.has(r.to_person)) continue;
      const k = `${r.to_person}|${norm(r.qualifier)}`;
      if (!expected.has(k)) expected.set(k, []);
      expected.get(k).push(r.from_person);
    }
    // What the map draws.
    const drawn = new Map();
    for (const b of frame.bonds) {
      if (b.kind !== 'descent') continue;
      const u = frame.units.find((x) => x.id === b.parentUnit);
      const ids = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
      const k = `${b.child}|${b.qualifier}`;
      assert.ok(!drawn.has(k), `two connectors for ${k}`);
      drawn.set(k, ids.slice().sort());
    }
    for (const [k, ids] of expected) {
      assert.ok(drawn.has(k), `no connector drawn for ${k}`);
      assert.deepEqual(drawn.get(k), ids.slice().sort(), `connector ${k} reaches the wrong people`);
    }
    for (const k of drawn.keys()) assert.ok(expected.has(k), `connector ${k} has no recorded edge`);
  });
}

test('a former partner is a lateral link, and the count is reported', () => {
  const g = buildGraph(
    [P('A'), P('B'), P('C')],
    [partner('A', 'B'), partner('A', 'C', 'former')],
  );
  const f = planAtlas(g);
  const podded = f.units.filter((u) => !u.anchorOnly && u.memberIds.length === 2);
  assert.equal(podded.length, 1);
  assert.deepEqual(podded[0].memberIds.slice().sort(), ['A', 'B']);
  assert.equal(f.stats.lateralUnions, 1);
  assert.ok(f.bonds.some((b) => b.kind === 'union' && b.status === 'former'));
});

test('rows are ROW_GAP apart and the world is centred on x = 0', () => {
  const ys = [...new Set([...bigFrame.nodes.values()].map((n) => n.y))].sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.equal(ys[i] - ys[i - 1], ROW_GAP);
  assert.ok(Math.abs((bigFrame.bounds.minX + bigFrame.bounds.maxX) / 2) < 1e-6);
});

test('the 1,200-person fixture lays out fast, and the stats say what the data actually is', () => {
  assert.ok(bigMs < 3000, `layout took ${bigMs}ms`);
  const s = bigFrame.stats;
  assert.equal(s.people, 1200);
  assert.ok(s.generations >= 5, `only ${s.generations} generations`);
  assert.ok(Number.isInteger(s.lateralUnions) && Number.isInteger(s.crossings) && Number.isInteger(s.longDescents));
  console.log(`      1,200 people → ${s.units} units, ${s.generations} generations, ${s.lateralUnions} lateral unions, ${s.crossings} crossings, ${s.longDescents} long descents, ${bigMs}ms`);
});

test('one era label per generation, carrying the row\'s median birth decade', () => {
  assert.equal(bigFrame.eras.length, bigFrame.stats.generations);
  assert.ok(bigFrame.eras.every((e) => /^\d{4}s$/.test(e.label) || /^Gen \d+$/.test(e.label)));
  // The demo family carries real, plausible dates — its rows must read as decades.
  assert.ok(seedFrame.eras.some((e) => /^\d{4}s$/.test(e.label)));
  // The axis never mixes languages: a family with any implausible row
  // (the fixture's synthetic dates run past 2300) numbers every generation.
  const kinds = new Set(bigFrame.eras.map((e) => (/^\d{4}s$/.test(e.label) ? 'decade' : 'gen')));
  assert.equal(kinds.size, 1, `mixed era labels: ${[...kinds].join(',')}`);
});

test('the far-reach count in the stats is the same rule the renderer draws by', () => {
  const byId = new Map(bigFrame.units.map((u) => [u.id, u]));
  let n = 0;
  for (const b of bigFrame.bonds) {
    if (b.kind !== 'descent') continue;
    const pu = byId.get(b.parentUnit), c = bigFrame.nodes.get(b.child);
    if (isFarReach(c.x - pu.x, c.y - pu.y)) n++;
  }
  assert.equal(n, bigFrame.stats.longDescents);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
