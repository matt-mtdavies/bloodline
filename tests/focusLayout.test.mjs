/**
 * The Focus Layer's positional guarantees.
 *
 * These are the invariants the force simulation could never hold at whole-tree
 * density — parents strictly above children, partners level and adjacent, a
 * former partner raised 10–45° to the side, children centred under their own
 * union, zero overlaps. A planner over ~20 people can simply guarantee them, so
 * this file pins each one as a fact rather than a tendency.
 *
 * Run with: node tests/focusLayout.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import {
  planFocusFamily, planFocusView, ROW, POD, MIN_DIAMETER, RADIUS, CLEARANCE,
} from '../src/viz/focus/focusLayout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const P = (id, extra = {}) => ({ id, display_name: id, ...extra });
const par = (from, to, qualifier) => ({ type: 'parent', from_person: from, to_person: to, qualifier });
const pt = (a, b, status = 'current') => ({ type: 'partner', from_person: a, to_person: b, partner_status: status });

/* A deliberately messy family: a current partner, a former partner, children
 * by each, two siblings either side by age, both parents, and one full set of
 * grandparents. Every shape the spec names, in one fixture. */
function messyFamily() {
  const people = [
    P('me', { birth_date: '1980' }),
    P('wife', { birth_date: '1982' }),
    P('ex', { birth_date: '1979' }),
    P('kidA', { birth_date: '2010' }),
    P('kidB', { birth_date: '2013' }),
    P('exKid', { birth_date: '2004' }),
    P('bigSis', { birth_date: '1976' }),
    P('lilBro', { birth_date: '1985' }),
    P('dad', { birth_date: '1950' }),
    P('mum', { birth_date: '1953' }),
    P('grandpa', { birth_date: '1920' }),
    P('grandma', { birth_date: '1924' }),
  ];
  const relationships = [
    pt('me', 'wife'), pt('me', 'ex', 'former'),
    par('me', 'kidA'), par('wife', 'kidA'),
    par('me', 'kidB'), par('wife', 'kidB'),
    par('me', 'exKid'), par('ex', 'exKid'),
    par('dad', 'me'), par('mum', 'me'),
    par('dad', 'bigSis'), par('mum', 'bigSis'),
    par('dad', 'lilBro'), par('mum', 'lilBro'),
    par('grandpa', 'dad'), par('grandma', 'dad'),
    pt('dad', 'mum'), pt('grandpa', 'grandma'),
  ];
  return buildGraph(people, relationships);
}

const at = (plan, id) => plan.nodes.find((n) => n.id === id);

test('the selected person is exactly at the world origin', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const me = at(plan, 'me');
  assert.equal(me.x, 0);
  assert.equal(me.y, 0);
});

test('a current partner is level with, and adjacent to, the selected person', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const wife = at(plan, 'wife');
  assert.equal(wife.y, 0, 'a current partner shares the row');
  assert.equal(Math.abs(wife.x - at(plan, 'me').x), POD, 'at exactly one pod spacing');
});

test('a former partner is raised above the row, 10–45° to the side', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const ex = at(plan, 'ex');
  assert.ok(ex.y < 0, 'a former partner sits ABOVE the hub row');
  const deg = Math.atan2(Math.abs(ex.y), Math.abs(ex.x)) * 180 / Math.PI;
  assert.ok(deg >= 10 && deg <= 45, `offset angle ${deg.toFixed(1)}° must be within 10–45°`);
});

test('the former partner takes the opposite side from the current partner', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  assert.ok(Math.sign(at(plan, 'ex').x) !== Math.sign(at(plan, 'wife').x));
});

test('every parent sits strictly above every one of their children', () => {
  const graph = messyFamily();
  const plan = planFocusFamily({ graph, personId: 'me' });
  const placed = new Map(plan.nodes.map((n) => [n.id, n]));
  let checked = 0;
  for (const r of graph.relationships.filter((x) => x.type === 'parent')) {
    const p = placed.get(r.from_person), c = placed.get(r.to_person);
    if (!p || !c) continue;
    checked++;
    assert.ok(p.y < c.y, `${r.from_person} (y=${p.y}) must be above ${r.to_person} (y=${c.y})`);
  }
  assert.ok(checked >= 8, `expected to actually check several parent links, checked ${checked}`);
});

test('siblings share the selected person\'s row, in birth order across it', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const row = ['bigSis', 'me', 'lilBro'].map((id) => at(plan, id));
  for (const n of row) assert.equal(n.y, 0);
  assert.ok(row[0].x < row[1].x, 'the older sibling reads to the left');
  assert.ok(row[1].x < row[2].x, 'the younger sibling reads to the right');
});

test('children are centred beneath the union that produced them', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const me = at(plan, 'me'), wife = at(plan, 'wife'), ex = at(plan, 'ex');
  const kids = [at(plan, 'kidA'), at(plan, 'kidB')];
  const kidMid = (kids[0].x + kids[1].x) / 2;
  assert.ok(Math.abs(kidMid - (me.x + wife.x) / 2) < 1, 'shared children centre under the couple');
  // The former partner's child hangs off the former partner's own union, which
  // is on the other side of centre entirely — the two chapters stay apart.
  assert.ok(Math.sign(at(plan, 'exKid').x) === Math.sign(ex.x));
});

test('children are one full row below the selected person', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  assert.equal(at(plan, 'kidA').y, ROW);
  assert.equal(at(plan, 'dad').y, -ROW);
  assert.equal(at(plan, 'grandpa').y, -ROW * 2);
});

test('no two bubbles overlap, anywhere in the plan', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  for (let i = 0; i < plan.nodes.length; i++) {
    for (let j = i + 1; j < plan.nodes.length; j++) {
      const a = plan.nodes[i], b = plan.nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(d >= a.r + b.r, `${a.id} and ${b.id} overlap (gap ${(d - a.r - b.r).toFixed(1)})`);
    }
  }
});

test('a person appears exactly once even when reachable by two routes', () => {
  // A grandparent who is also, through a second edge, a parent must not be
  // planted on two rows at once.
  const people = [P('me'), P('dad'), P('gran')];
  const relationships = [par('dad', 'me'), par('gran', 'dad'), par('gran', 'me')];
  const plan = planFocusFamily({ graph: buildGraph(people, relationships), personId: 'me' });
  const ids = plan.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate placement: ${ids.join(',')}`);
});

test('identical input produces byte-identical output', () => {
  const a = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const b = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const strip = (p) => JSON.stringify(p.nodes.map((n) => [n.id, n.x, n.y, n.r, n.role]));
  assert.equal(strip(a), strip(b));
});

test('a name-only stub still plans — one bubble, no crash', () => {
  const plan = planFocusFamily({ graph: buildGraph([P('lonely')], []), personId: 'lonely' });
  assert.equal(plan.nodes.length, 1);
  assert.equal(plan.nodes[0].x, 0);
});

test('an unknown person plans to nothing rather than throwing', () => {
  const plan = planFocusFamily({ graph: buildGraph([P('a')], []), personId: 'ghost' });
  assert.equal(plan.nodes.length, 0);
  assert.equal(plan.bounds, null);
});

test('legibility: a bubble is never drawn below the floor — the view pans instead', () => {
  const graph = messyFamily();
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const plan = planFocusView({ graph, personId: 'me', viewport });
    assert.ok(plan.smallestDiameter >= MIN_DIAMETER - 0.001,
      `${viewport.width}px: smallest bubble ${plan.smallestDiameter.toFixed(1)}px is under the floor`);
    assert.equal(plan.pannable, plan.zoom > plan.fitZoom + 1e-6);
  }
  // On a laptop the whole four-generation family fits without panning at all —
  // that is what the floor was chosen against.
  const desk = planFocusView({ graph, personId: 'me', viewport: { width: 1440, height: 855 } });
  assert.equal(desk.pannable, false, 'a laptop shows the family whole');
  assert.ok(desk.nodes.some((n) => n.role === 'grandparent'));
});

test('capacity: a family beyond the viewport\'s budget sheds its outermost ring', () => {
  // Twenty children puts this well past the phone budget.
  const people = [P('me', { birth_date: '1980' }), P('dad'), P('gran')];
  const relationships = [par('dad', 'me'), par('gran', 'dad')];
  for (let i = 0; i < 20; i++) {
    people.push(P(`kid${i}`, { birth_date: `20${10 + i}` }));
    relationships.push(par('me', `kid${i}`));
  }
  const graph = buildGraph(people, relationships);
  const phone = planFocusView({ graph, personId: 'me', viewport: { width: 390, height: 844 } });
  assert.equal(phone.trimmed, true, 'the grandparent ring is what gets shed');
  assert.ok(!phone.nodes.some((n) => n.role === 'grandparent'));
  assert.ok(phone.nodes.some((n) => n.role === 'parent'), 'the parent ring survives the trim');

  const desk = planFocusView({ graph, personId: 'me', viewport: { width: 1440, height: 900 } });
  assert.equal(desk.trimmed, false, 'a desktop budget of 40 holds this family whole');
  assert.ok(desk.nodes.some((n) => n.role === 'grandparent'));
});

test('a child group slides as a rigid unit rather than being torn apart', () => {
  // Two co-parents whose unions sit almost on top of each other: the groups
  // must separate without a single child crossing into the other's fan.
  const people = [P('me'), P('a'), P('b'),
    P('a1', { birth_date: '2001' }), P('a2', { birth_date: '2002' }),
    P('b1', { birth_date: '2003' }), P('b2', { birth_date: '2004' })];
  const relationships = [
    pt('me', 'a'), pt('me', 'b'),
    par('me', 'a1'), par('a', 'a1'), par('me', 'a2'), par('a', 'a2'),
    par('me', 'b1'), par('b', 'b1'), par('me', 'b2'), par('b', 'b2'),
  ];
  const plan = planFocusFamily({ graph: buildGraph(people, relationships), personId: 'me' });
  const x = (id) => at(plan, id).x;
  assert.ok(Math.max(x('a1'), x('a2')) < Math.min(x('b1'), x('b2')),
    'the two broods stay in separate territories');
  assert.ok(Math.abs((x('a2') - x('a1')) - (x('b2') - x('b1'))) < 1e-6,
    'both groups keep identical internal spacing — neither was stretched');
});

test('bubble weight falls off with distance from the selected person', () => {
  assert.ok(RADIUS.self > RADIUS.partner);
  assert.ok(RADIUS.partner > RADIUS.grandparent);
  assert.ok(CLEARANCE > 0);
});

test('every node carries a human relationship label', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  assert.equal(at(plan, 'me').label, 'You');
  assert.equal(at(plan, 'wife').label, 'Partner');
  assert.equal(at(plan, 'ex').label, 'Former partner');
  for (const n of plan.nodes) assert.ok(n.label && n.label.length, `${n.id} has no label`);
});

test('the descent bundles cover every generational link that was drawn', () => {
  const plan = planFocusFamily({ graph: messyFamily(), personId: 'me' });
  const kinds = plan.bundles.map((b) => b.ring).sort();
  assert.ok(plan.bundles.length >= 4, 'children (x2), siblings, grandparents');
  assert.ok(kinds.length === new Set(plan.bundles.map((b) => b.to.map((n) => n.id).join())).size,
    'no two bundles claim the same set of children');
  for (const b of plan.bundles) {
    assert.ok(Number.isFinite(b.junctionX), 'each bundle knows where its trunk lands');
    for (const n of b.to) assert.ok(b.from.y < n.y, 'a trunk always descends');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
