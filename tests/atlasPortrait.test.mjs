/**
 * The Family Portrait — composition, against the shapes that actually break
 * things.
 *
 * A portrait makes CLAIMS about a family: this is your mother, this is your
 * ex, these are her children and not his. Those claims are asserted here
 * rather than eyeballed, on the difficult real-family shapes: several
 * partners and former partners, full and half and step siblings, biological
 * and adoptive and step parents, unknown parents, and children from
 * different partnerships.
 *
 * Run with: node tests/atlasPortrait.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { people as seedPeople, relationships as seedRels } from '../src/data/seed.js';
import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';
import { composePortrait } from '../src/viz/atlas/portrait.js';
import { NODE_R } from '../src/viz/atlas/layout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const P = (id, extra = {}) => ({ id, display_name: id, ...extra });
const parent = (from, to, qualifier) => ({ id: `r${from}${to}`, type: 'parent', from_person: from, to_person: to, qualifier });
const partner = (a, b, status = 'current') => ({ id: `p${a}${b}`, type: 'partner', from_person: a, to_person: b, partner_status: status });

/** Every bond a portrait draws must correspond to a recorded edge, and every
 *  person in it must be someone with a real relationship to the focus. This
 *  is the guarantee the whole feature rests on. */
function assertTruthful(graph, f, focusId) {
  const rel = new Set();
  for (const r of graph.relationships) {
    if (r.type === 'parent') rel.add(`P|${r.from_person}|${r.to_person}`);
    if (r.type === 'partner') { rel.add(`U|${r.from_person}|${r.to_person}`); rel.add(`U|${r.to_person}|${r.from_person}`); }
  }
  for (const b of f.bonds) {
    if (b.kind === 'union' || b.kind === 'thread') {
      assert.ok(rel.has(`U|${b.a}|${b.b}`), `drew a union ${b.a}–${b.b} with no partner edge`);
      continue;
    }
    const u = f.unitById.get(b.parentUnit);
    assert.ok(u, `descent to ${b.child} names a unit that is not in the portrait`);
    const ids = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
    assert.ok(ids.length, `descent to ${b.child} reaches nobody`);
    for (const pid of ids) {
      assert.ok(rel.has(`P|${pid}|${b.child}`), `drew ${pid} as a parent of ${b.child} with no such edge`);
    }
  }
  // Everyone present is a recorded relative of the focus.
  const kin = new Set([focusId]);
  for (const p of graph.parents(focusId)) kin.add(p.id);
  for (const c of graph.children(focusId)) kin.add(c.id);
  for (const p of graph.partners(focusId)) kin.add(p.id);
  for (const s of graph.siblings(focusId)) kin.add(s.id);
  for (const id of f.nodes.keys()) assert.ok(kin.has(id), `${id} is in the portrait but is not related to the focus`);
}

test('nobody appears twice, and the focus is the focus', () => {
  const g = buildGraph(
    [P('ME'), P('MUM'), P('DAD'), P('WIFE'), P('KID'), P('SIS')],
    [parent('MUM', 'ME'), parent('DAD', 'ME'), parent('MUM', 'SIS'), parent('DAD', 'SIS'),
      partner('MUM', 'DAD'), partner('ME', 'WIFE'), parent('ME', 'KID'), parent('WIFE', 'KID')],
  );
  const f = composePortrait(g, 'ME');
  assert.equal(f.nodes.size, 6);
  assert.equal(f.count, 6);
  assert.ok(f.nodes.get('ME').isFocus);
  assert.equal(f.roles.get('MUM'), 'parent');
  assert.equal(f.roles.get('WIFE'), 'partner');
  assert.equal(f.roles.get('KID'), 'child');
  assert.equal(f.roles.get('SIS'), 'sibling');
  assertTruthful(g, f, 'ME');
});

test('parents sit above, children below, partners beside', () => {
  const g = buildGraph(
    [P('ME'), P('MUM'), P('WIFE'), P('KID')],
    [parent('MUM', 'ME'), partner('ME', 'WIFE'), parent('ME', 'KID'), parent('WIFE', 'KID')],
  );
  const f = composePortrait(g, 'ME');
  assert.ok(f.nodes.get('MUM').y < f.nodes.get('ME').y, 'a parent is above');
  assert.ok(f.nodes.get('KID').y > f.nodes.get('ME').y, 'a child is below');
  assert.equal(f.nodes.get('WIFE').y, f.nodes.get('ME').y, 'a partner is level');
  assert.notEqual(f.nodes.get('WIFE').x, f.nodes.get('ME').x, 'a partner is beside, not on top');
});

test('several partners: current on one side, former on the other, all drawn as what they are', () => {
  const g = buildGraph(
    [P('ME'), P('NOW'), P('EX1'), P('EX2')],
    [partner('ME', 'NOW'), partner('ME', 'EX1', 'former'), partner('ME', 'EX2', 'former')],
  );
  const f = composePortrait(g, 'ME');
  assert.equal(f.roles.get('NOW'), 'partner');
  assert.equal(f.roles.get('EX1'), 'former-partner');
  assert.ok(f.nodes.get('NOW').x > 0, 'the current partner takes one side');
  assert.ok(f.nodes.get('EX1').x < 0 && f.nodes.get('EX2').x < 0, 'former partners take the other');
  assert.notEqual(f.nodes.get('EX1').x, f.nodes.get('EX2').x, 'two exes do not stack');
  const unions = f.bonds.filter((b) => b.kind === 'union');
  assert.equal(unions.filter((b) => b.status === 'former').length, 2);
  assert.equal(unions.filter((b) => b.status === 'current').length, 1);
  assertTruthful(g, f, 'ME');
});

/* This is the fix for a real measured failure: the widest portrait in a
 * 1,200-person fixture was someone with eight recorded current partners in
 * one straight line, 2,684 units across — wider than a phone AND a desktop
 * at the lens's own minimum readable zoom. A group past a few per row must
 * wrap into further rows rather than keep reaching sideways forever. */
test('a large partner group wraps into rows instead of reaching sideways forever', () => {
  const g = buildGraph(
    [P('ME'), ...Array.from({ length: 9 }, (_, i) => P(`P${i}`))],
    Array.from({ length: 9 }, (_, i) => partner('ME', `P${i}`)),
  );
  const f = composePortrait(g, 'ME');
  const xs = Array.from({ length: 9 }, (_, i) => f.nodes.get(`P${i}`).x);
  const ys = Array.from({ length: 9 }, (_, i) => f.nodes.get(`P${i}`).y);
  assert.ok(Math.max(...xs) < 700, `nine partners should not still be in one line (widest x: ${Math.max(...xs)})`);
  assert.ok(new Set(ys).size > 1, 'a group this large must use more than one row');
  assertTruthful(g, f, 'ME');
});

test('a large sibling group wraps too, and stays balanced on both sides', () => {
  const g = buildGraph(
    [P('ME'), P('MUM'), ...Array.from({ length: 10 }, (_, i) => P(`S${i}`))],
    [
      parent('MUM', 'ME'),
      ...Array.from({ length: 10 }, (_, i) => parent('MUM', `S${i}`)),
    ],
  );
  const f = composePortrait(g, 'ME');
  const xs = Array.from({ length: 10 }, (_, i) => f.nodes.get(`S${i}`).x);
  assert.ok(xs.some((x) => x < 0) && xs.some((x) => x > 0), 'ten siblings still split across both sides');
  assert.ok(Math.max(...xs.map(Math.abs)) < 1200, `should not reach further out just because there are more of them (widest: ${Math.max(...xs.map(Math.abs))})`);
  assertTruthful(g, f, 'ME');
});

test('a large sibling group wraps upward across several rows and still clears the parent row', () => {
  // 16, split across two sides, forces each side past MAX_ARM (4) into a
  // second row — the actual shape this bound exists to protect: rows
  // stacking toward the parents must still land short of them.
  const g = buildGraph(
    [P('ME'), P('MUM'), P('DAD'), ...Array.from({ length: 16 }, (_, i) => P(`S${i}`))],
    [
      parent('MUM', 'ME'), parent('DAD', 'ME'), partner('MUM', 'DAD'),
      ...Array.from({ length: 16 }, (_, i) => [parent('MUM', `S${i}`), parent('DAD', `S${i}`)]).flat(),
    ],
  );
  const f = composePortrait(g, 'ME');
  const parentY = f.nodes.get('MUM').y;
  const sibYs = new Set();
  for (let i = 0; i < 16; i++) {
    const sib = f.nodes.get(`S${i}`);
    assert.ok(sib.y > parentY, `sibling ${i} must stay below the parent row, not level with or above it`);
    sibYs.add(sib.y);
  }
  assert.ok(sibYs.size > 1, 'a group this large must actually use more than one row');
  assertTruthful(g, f, 'ME');
});

test('a large group of children under one couple wraps as one block, never spilling into a sibling group', () => {
  const g = buildGraph(
    [P('ME'), P('SPOUSE'), ...Array.from({ length: 9 }, (_, i) => P(`K${i}`))],
    [
      partner('ME', 'SPOUSE'),
      ...Array.from({ length: 9 }, (_, i) => [parent('ME', `K${i}`), parent('SPOUSE', `K${i}`)]).flat(),
    ],
  );
  const f = composePortrait(g, 'ME');
  const xs = Array.from({ length: 9 }, (_, i) => f.nodes.get(`K${i}`).x);
  const ys = Array.from({ length: 9 }, (_, i) => f.nodes.get(`K${i}`).y);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 700, `nine children should not still be in one wide row (span: ${Math.max(...xs) - Math.min(...xs)})`);
  assert.ok(new Set(ys).size > 1, 'a group this large must use more than one row');
  for (const cid of [...Array.from({ length: 9 }, (_, i) => `K${i}`)]) {
    const b = f.bonds.find((x) => x.kind === 'descent' && x.child === cid);
    const u = f.unitById.get(b.parentUnit);
    assert.deepEqual((u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds).slice().sort(), ['ME', 'SPOUSE'], `${cid} must still descend from exactly the right couple once wrapped`);
  }
  assertTruthful(g, f, 'ME');
});

test('children from different partnerships hang from the right parents, never the wrong couple', () => {
  const g = buildGraph(
    [P('ME'), P('NOW'), P('EX'), P('KID_NOW'), P('KID_EX'), P('KID_ALONE')],
    [
      partner('ME', 'NOW'), partner('ME', 'EX', 'former'),
      parent('ME', 'KID_NOW'), parent('NOW', 'KID_NOW'),
      parent('ME', 'KID_EX'), parent('EX', 'KID_EX'),
      parent('ME', 'KID_ALONE'),
    ],
  );
  const f = composePortrait(g, 'ME');
  const parentsDrawnFor = (child) => {
    const b = f.bonds.find((x) => x.kind === 'descent' && x.child === child);
    const u = f.unitById.get(b.parentUnit);
    return (u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds).slice().sort();
  };
  assert.deepEqual(parentsDrawnFor('KID_NOW'), ['ME', 'NOW']);
  assert.deepEqual(parentsDrawnFor('KID_EX'), ['EX', 'ME']);
  assert.deepEqual(parentsDrawnFor('KID_ALONE'), ['ME']);
  // And they sit over the couple they belong to, not all in one heap.
  assert.ok(f.nodes.get('KID_EX').x < f.nodes.get('KID_ALONE').x, "the ex's child sits on the ex's side");
  assert.ok(f.nodes.get('KID_NOW').x > f.nodes.get('KID_ALONE').x, "the partner's child sits on their side");
  assertTruthful(g, f, 'ME');
});

test('biological, adoptive and step parents are each drawn as themselves', () => {
  const g = buildGraph(
    [P('ME'), P('BIO'), P('ADO'), P('STEP')],
    [parent('BIO', 'ME', 'biological'), parent('ADO', 'ME', 'adoptive'), parent('STEP', 'ME', 'step')],
  );
  const f = composePortrait(g, 'ME');
  const byQualifier = new Map(
    f.bonds.filter((b) => b.kind === 'descent' && b.child === 'ME')
      .map((b) => {
        const u = f.unitById.get(b.parentUnit);
        return [b.qualifier, (u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds).slice().sort()];
      }),
  );
  assert.deepEqual(byQualifier.get('biological'), ['BIO']);
  assert.deepEqual(byQualifier.get('adoptive'), ['ADO']);
  assert.deepEqual(byQualifier.get('step'), ['STEP']);
  assert.equal(f.roles.get('STEP'), 'step-parent');
  assert.equal(f.roles.get('BIO'), 'parent');
  assertTruthful(g, f, 'ME');
});

test('full, half and step siblings all appear, each through the parents they really share', () => {
  const g = buildGraph(
    [P('ME'), P('MUM'), P('DAD'), P('OTHER'), P('STEPDAD'), P('FULL'), P('HALF'), P('STEPSIB')],
    [
      parent('MUM', 'ME'), parent('DAD', 'ME'),
      parent('MUM', 'FULL'), parent('DAD', 'FULL'),
      parent('MUM', 'HALF'), parent('OTHER', 'HALF'),
      parent('STEPDAD', 'ME', 'step'), parent('STEPDAD', 'STEPSIB'),
    ],
  );
  const f = composePortrait(g, 'ME');
  assert.equal(f.siblingKind.get('FULL'), 'full');
  assert.equal(f.siblingKind.get('HALF'), 'half');
  assert.equal(f.siblingKind.get('STEPSIB'), 'step');
  for (const s of ['FULL', 'HALF', 'STEPSIB']) assert.equal(f.roles.get(s), 'sibling');
  // The half-sibling descends from the ONE parent shared with the focus, and
  // is never drawn as a child of the couple.
  const halfBonds = f.bonds.filter((b) => b.kind === 'descent' && b.child === 'HALF');
  const reached = new Set();
  for (const b of halfBonds) {
    const u = f.unitById.get(b.parentUnit);
    for (const id of (u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds)) reached.add(id);
  }
  assert.ok(reached.has('MUM'), 'the half-sibling must reach the parent they share');
  assert.ok(!reached.has('DAD'), 'and must NOT be drawn as a child of the parent they do not');
  assertTruthful(g, f, 'ME');
});

test('unknown parents are an absence, not an invention', () => {
  const g = buildGraph([P('ME'), P('KID')], [parent('ME', 'KID')]);
  const f = composePortrait(g, 'ME');
  assert.equal(f.nodes.size, 2);
  assert.ok(![...f.nodes.keys()].some((id) => /unknown|placeholder/i.test(id)));
  assert.equal(f.bonds.filter((b) => b.kind === 'descent' && b.child === 'ME').length, 0);
  assertTruthful(g, f, 'ME');
});

test('a person with nobody recorded still composes — just themselves', () => {
  const g = buildGraph([P('ALONE')], []);
  const f = composePortrait(g, 'ALONE');
  assert.equal(f.nodes.size, 1);
  assert.equal(f.bonds.length, 0);
  assert.ok(f.nodes.get('ALONE').isFocus);
});

test('an unknown focus composes to nothing rather than throwing', () => {
  const g = buildGraph([P('A')], []);
  assert.equal(composePortrait(g, 'nobody'), null);
});

test('deterministic, and truthful across the whole demo family', () => {
  const g = buildGraph(seedPeople, seedRels);
  for (const p of g.people) {
    const a = composePortrait(g, p.id);
    const b = composePortrait(g, p.id);
    assert.equal(a.nodes.size, b.nodes.size);
    for (const [id, n] of a.nodes) {
      assert.equal(n.x, b.nodes.get(id).x);
      assert.equal(n.y, b.nodes.get(id).y);
    }
    assertTruthful(g, a, p.id);
  }
});

test('truthful across a representative 1,200-person family, and never unbounded', () => {
  const { tree } = generateFamilyFixture({ size: 1200, seed: 7 });
  const g = buildGraph(tree.people, tree.relationships);
  let biggest = 0;
  for (const p of g.people) {
    const f = composePortrait(g, p.id);
    assertTruthful(g, f, p.id);
    biggest = Math.max(biggest, f.nodes.size);
  }
  // A portrait is an immediate family, so it stays small however large the
  // tree is — that is what makes it affordable to draw in the foreground.
  assert.ok(biggest < 40, `a portrait grew to ${biggest} people`);
  console.log(`      largest portrait in 1,200 people: ${biggest}`);
});

/* The count staying small doesn't mean the SHAPE stays legible — the real
 * bug this was built to catch was one person with eight recorded current
 * partners in a straight line, 2,684 units wide, found only by actually
 * measuring width across a real fixture rather than eyeballing a handful of
 * hand-built cases. Checked at both the size this composer was tuned
 * against and the programme's actual 5,000-person target, so a width bound
 * that happens to hold at one scale isn't mistaken for one that holds at
 * both. */
test('no portrait grows wider than the lens can actually show, at either scale', () => {
  for (const size of [1200, 5000]) {
    const { tree } = generateFamilyFixture({ size, seed: 7 });
    const g = buildGraph(tree.people, tree.relationships);
    let widest = 0;
    for (const p of g.people) {
      const f = composePortrait(g, p.id);
      widest = Math.max(widest, f.bounds.maxX - f.bounds.minX);
    }
    assert.ok(widest < 2000, `${size}-person family: widest portrait was ${Math.round(widest)} units`);
  }
});

/* Two portraits drawn on top of each other is the one composition failure a
 * truthfulness check cannot catch — every claim can be correct and the
 * picture still unreadable. A child of a former partner and a child of the
 * current one both reaching for the middle of the row is exactly how it
 * happens, so it is asserted across whole families rather than one fixture. */
test('no two people in a portrait are drawn on top of each other', () => {
  const families = [
    ['the demo family', buildGraph(seedPeople, seedRels)],
    ['1,200 people', (() => { const { tree } = generateFamilyFixture({ size: 1200, seed: 7 }); return buildGraph(tree.people, tree.relationships); })()],
  ];
  for (const [label, g] of families) {
    for (const p of g.people) {
      const f = composePortrait(g, p.id);
      const pts = [...f.nodes.entries()];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const [ai, a] = pts[i], [bi, b] = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          assert.ok(d >= NODE_R * 2, `${label}: ${ai} and ${bi} overlap in ${p.id}'s portrait (${Math.round(d)}px apart)`);
        }
      }
    }
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
