/**
 * Canopy growth choreography — the timing suite.
 *
 * growth.js claims the choreography "can be asserted in tests rather than
 * watched and hoped about". This is that. It exists because trying to verify
 * the animation by screenshot proved useless: the host element appears before
 * Pixi has finished its async init, so a capture clock started from the DOM
 * is not the clock the growth actually runs on, and every frame came back
 * already settled. The schedule is a pure function — assert it directly.
 *
 * Run with: node tests/canopyGrowth.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { planCanopy } from '../src/viz/canopy/plan.js';
import { scheduleGrowth, progressAt, easeBranch, easeBud, bondKey, STAGGER_MS } from '../src/viz/canopy/growth.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const P = (id, extra = {}) => ({ id, display_name: id, ...extra });
const parent = (f, t, q) => ({ id: `r${f}${t}`, type: 'parent', from_person: f, to_person: t, qualifier: q });
const partner = (a, b, s = 'current') => ({ id: `p${a}${b}`, type: 'partner', from_person: a, to_person: b, partner_status: s });

const people = [
  P('GA', { birth_date: '1920-01-01' }), P('GB', { birth_date: '1922-01-01' }),
  P('PA', { birth_date: '1950-01-01' }), P('PB', { birth_date: '1952-01-01' }),
  P('ME', { birth_date: '1985-01-01' }), P('SP', { birth_date: '1986-01-01' }),
  P('SIB', { birth_date: '1990-01-01' }),
  P('C1', { birth_date: '2010-01-01' }), P('C2', { birth_date: '2013-01-01' }), P('C3', { birth_date: '2016-01-01' }),
];
const rels = [
  partner('GA', 'GB'), parent('GA', 'PA'), parent('GB', 'PA'),
  partner('PA', 'PB'), parent('PA', 'ME'), parent('PB', 'ME'),
  parent('PA', 'SIB'), parent('PB', 'SIB'),
  partner('ME', 'SP'),
  parent('ME', 'C1'), parent('SP', 'C1'),
  parent('ME', 'C2'), parent('SP', 'C2'),
  parent('ME', 'C3'), parent('SP', 'C3'),
];
const graph = buildGraph(people, rels);
const frame = planCanopy(graph, 'ME');
const sched = scheduleGrowth(frame, {});
const startOf = (id) => sched.nodes.get(id).delay;

test('the focus person is already there — never grows, never waits', () => {
  const s = sched.nodes.get('ME');
  assert.equal(s.delay, 0);
  assert.equal(s.dur, 0);
  assert.equal(progressAt(s, 0), 1, 'fully present at t=0');
});

test('everyone else genuinely grows — nobody is simply present', () => {
  for (const [id, s] of sched.nodes) {
    if (id === 'ME') continue;
    assert.ok(s.dur > 0, `${id} has no growth duration`);
    assert.equal(progressAt(s, 0), 0, `${id} is already visible at t=0`);
  }
});

test('children unfurl eldest to youngest, one stagger step apart', () => {
  const c1 = startOf('C1'), c2 = startOf('C2'), c3 = startOf('C3');
  assert.ok(c1 < c2 && c2 < c3, `expected C1 < C2 < C3, got ${c1}, ${c2}, ${c3}`);
  assert.ok(Math.abs((c2 - c1) - STAGGER_MS) < 1, `stagger should be ${STAGGER_MS}ms, got ${c2 - c1}`);
  assert.ok(Math.abs((c3 - c2) - STAGGER_MS) < 1, 'stagger is even across the whole group');
});

test('the stagger order matches the LAYOUT order, not a second sort', () => {
  // Left-to-right on the row IS birth order (plan.js) — the two must agree by
  // construction, or the eldest child could open on the right of the screen.
  const byStart = ['C1', 'C2', 'C3'].sort((a, b) => startOf(a) - startOf(b));
  const byX = ['C1', 'C2', 'C3'].sort((a, b) => frame.nodes.get(a).x - frame.nodes.get(b).x);
  assert.deepEqual(byStart, byX);
});

test('a person opens only once the FIRST branch reaching them is under way', () => {
  /* Deliberately the earliest branch, not every branch. Someone can be
   * reached from more than one direction — a parent is reached both by the
   * descent to their own child and, later, by the descent from THEIR
   * parents — and they should appear with whichever arrives first, then
   * simply already be there when the second one lands. An earlier version of
   * this test required every branch to precede them and failed on exactly
   * that case, which is correct behaviour, not a bug. */
  const earliestBond = new Map();
  frame.bonds.forEach((b, i) => {
    const bs = sched.bonds.get(bondKey(b, i));
    if (!bs) return;
    const touched = b.kind === 'union'
      ? [b.a, b.b]
      : [b.child, ...(frame.units.find((u) => u.id === b.parentUnit)?.memberIds ?? [])];
    for (const id of touched) {
      const prev = earliestBond.get(id);
      if (prev === undefined || bs.delay < prev) earliestBond.set(id, bs.delay);
    }
  });
  for (const [id, ns] of sched.nodes) {
    if (id === 'ME') continue;
    const first = earliestBond.get(id);
    if (first === undefined) continue; // reached by no bond at all
    assert.ok(ns.delay >= first, `${id} opens at ${ns.delay} before any branch reaches it (${first})`);
  }
});

test('the canopy opens in BOTH directions at once, not one after the other', () => {
  // A child and a parent should both be under way before the outer bands.
  const firstChild = startOf('C1');
  const parentStart = startOf('PA');
  const grandStart = startOf('GA');
  assert.ok(firstChild < grandStart, 'children lead the grandparents');
  assert.ok(parentStart < grandStart, 'parents lead the grandparents');
  assert.ok(Math.abs(firstChild - parentStart) < 400, 'both directions run concurrently, not sequentially');
});

test('horizon marks come last, after the shape has settled', () => {
  let lastPerson = 0;
  for (const s of sched.nodes.values()) lastPerson = Math.max(lastPerson, s.delay + s.dur);
  assert.ok(sched.horizonDelay >= lastPerson, 'horizons wait for the people');
  assert.equal(sched.total, sched.horizonDelay + sched.horizonDur);
});

test('the whole thing is over in about a second — cinematic, not slow', () => {
  assert.ok(sched.total > 500, `too quick to read: ${sched.total}ms`);
  assert.ok(sched.total < 1600, `too slow to sit through: ${sched.total}ms`);
});

test('reduced motion is a designed alternative, not the animation switched off', () => {
  const r = scheduleGrowth(frame, { reducedMotion: true });
  assert.ok(r.reduced);
  assert.equal(r.total, 120, 'one short fade');
  for (const [id, s] of r.nodes) {
    assert.equal(s.delay, 0, `${id} should not be staggered under reduced motion`);
    assert.ok(s.fade, 'fades rather than grows');
  }
  // Critically: the same people are scheduled either way. Layout never
  // depended on the animation, so reduced motion must not change WHO appears.
  assert.deepEqual([...r.nodes.keys()].sort(), [...sched.nodes.keys()].sort());
});

test('every drawn person and every bond has a schedule — nothing renders unscheduled', () => {
  for (const id of frame.nodes.keys()) assert.ok(sched.nodes.has(id), `${id} has no schedule`);
  frame.bonds.forEach((b, i) => assert.ok(sched.bonds.has(bondKey(b, i)), 'a bond has no schedule'));
});

test('easing curves are well behaved at both ends', () => {
  assert.equal(easeBranch(0), 0);
  assert.equal(easeBranch(1), 1);
  assert.equal(easeBud(1), 1);
  assert.ok(easeBud(0.5) > 0, 'the bud is opening by halfway');
  // A branch must never overshoot its own length — it is a physical thing.
  for (let u = 0; u <= 1; u += 0.05) {
    const v = easeBranch(u);
    assert.ok(v >= 0 && v <= 1, `easeBranch(${u.toFixed(2)}) = ${v} is out of range`);
  }
});

test('progressAt clamps outside the window', () => {
  const s = { delay: 100, dur: 200 };
  assert.equal(progressAt(s, 0), 0);
  assert.equal(progressAt(s, 100), 0);
  assert.equal(progressAt(s, 200), 0.5);
  assert.equal(progressAt(s, 300), 1);
  assert.equal(progressAt(s, 10000), 1);
});

test('deterministic — the same frame always yields the same score', () => {
  const a = scheduleGrowth(frame, {});
  const b = scheduleGrowth(frame, {});
  const ser = (s) => JSON.stringify([...s.nodes.entries()].sort((x, y) => x[0].localeCompare(y[0])));
  assert.equal(ser(a), ser(b));
});

test('a lone person with no relatives still produces a valid, finite score', () => {
  const g = buildGraph([P('ALONE')], []);
  const f = planCanopy(g, 'ALONE');
  const s = scheduleGrowth(f, {});
  assert.equal(s.nodes.get('ALONE').dur, 0, 'the focus never grows');
  assert.ok(Number.isFinite(s.total) && s.total > 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
