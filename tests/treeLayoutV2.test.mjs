/**
 * Deterministic layout invariants for the V2 planner.
 *
 * These are the STRUCTURAL claims: given a family and a selected person, where
 * does everyone belong? They are asserted across the whole structural fixture
 * suite rather than one hand-picked family, because the V1 problems were all
 * shapes that happened not to be the shape anyone tested.
 *
 * Motion is tested separately and integrated — see treeMotionV2.test.mjs.
 * Run with: node tests/treeLayoutV2.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { FIXTURES, fixtureById } from '../src/viz/v2/fixtures.js';
import { planFamilyLayout, ROW_GAP, POD_GAP } from '../src/viz/v2/layoutPlanner.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const VIEWPORT = { width: 1200, height: 800 };
const graphOf = (f) => buildGraph(f.people, f.relationships);
const planOf = (f, activeId = f.focus, extra = {}) =>
  planFamilyLayout({ graph: graphOf(f), activeId, viewport: VIEWPORT, ...extra });

const rowOf = (plan, id) => Math.round(plan.positions.get(id).y / ROW_GAP);
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive' || q === 'adopted';

/* ── The invariant that everything else leans on ─────────────────────────── */

test('the active person is at the world origin, in every fixture, for every person', () => {
  for (const f of FIXTURES) {
    const graph = graphOf(f);
    for (const person of graph.people) {
      const plan = planFamilyLayout({ graph, activeId: person.id, viewport: VIEWPORT });
      const at = plan.positions.get(person.id);
      assert.equal(at.x, 0, `${f.id}/${person.id} x`);
      assert.equal(at.y, 0, `${f.id}/${person.id} y`);
    }
  }
});

test('the plan is deterministic — same input, byte-identical output', () => {
  for (const f of FIXTURES) {
    const a = planOf(f);
    const b = planOf(f);
    const ser = (plan) => JSON.stringify([...plan.positions.entries()].sort());
    assert.equal(ser(a), ser(b), f.id);
    assert.deepEqual(a.camera, b.camera, `${f.id} camera`);
  }
});

test('input order does not change the outcome', () => {
  const f = fixtureById('remarried');
  const straight = planFamilyLayout({
    graph: buildGraph(f.people, f.relationships), activeId: f.focus, viewport: VIEWPORT,
  });
  const shuffled = planFamilyLayout({
    graph: buildGraph([...f.people].reverse(), [...f.relationships].reverse()),
    activeId: f.focus,
    viewport: VIEWPORT,
  });
  for (const [id, pt] of straight.positions) {
    const other = shuffled.positions.get(id);
    assert.ok(Math.abs(pt.x - other.x) < 1e-9 && Math.abs(pt.y - other.y) < 1e-9,
      `${id} moved when the input order changed (${pt.x},${pt.y}) vs (${other.x},${other.y})`);
  }
});

/* ── Composition rules ───────────────────────────────────────────────────── */

test('partners AND former partners share the active person\'s row', () => {
  for (const f of FIXTURES) {
    const graph = graphOf(f);
    const plan = planOf(f);
    for (const pt of graph.partners(f.focus)) {
      assert.equal(rowOf(plan, pt.id), 0,
        `${f.id}: ${pt.id} (${pt.status}) should share the active row`);
      assert.equal(plan.positions.get(pt.id).y, 0, `${f.id}: ${pt.id} y`);
    }
  }
});

test('a three-partner pod puts formers left of the hub and the current partner right', () => {
  const f = fixtureById('three-pod');
  const plan = planOf(f);
  const x = (id) => plan.positions.get(id).x;
  assert.ok(x('t_ex1') < 0 && x('t_ex2') < 0, 'both exes sit left of the hub');
  assert.ok(x('t_now') > 0, 'the current partner sits right of the hub');
  assert.equal(x('t_hub'), 0);
  // Pod spacing is exactly POD_GAP per step out from the hub.
  assert.equal(Math.abs(x('t_now')), POD_GAP);
});

test('every parent is strictly above every one of their children', () => {
  for (const f of FIXTURES) {
    const graph = graphOf(f);
    for (const person of graph.people) {
      const plan = planFamilyLayout({ graph, activeId: person.id, viewport: VIEWPORT });
      for (const p of graph.people) {
        for (const c of graph.children(p.id)) {
          if (!isBioAdopt(c.qualifier)) continue;
          assert.ok(rowOf(plan, p.id) < rowOf(plan, c.id),
            `${f.id} (active ${person.id}): ${p.id} row ${rowOf(plan, p.id)} not above ${c.id} row ${rowOf(plan, c.id)}`);
        }
      }
    }
  }
});

test('siblings share one row', () => {
  const f = fixtureById('wide-siblings');
  const plan = planOf(f);
  const rows = new Set();
  for (let i = 1; i <= 8; i++) rows.add(rowOf(plan, `w_s${i}`));
  assert.equal(rows.size, 1, `expected one sibling row, got ${[...rows]}`);
  assert.equal([...rows][0], 0, 'the sibling rank is the active row');
});

test('both child sets of a blended family land on one row below the adults', () => {
  const f = fixtureById('remarried');
  const plan = planOf(f);
  const adults = [rowOf(plan, 'r_heather'), rowOf(plan, 'r_ken'), rowOf(plan, 'r_chris')];
  assert.deepEqual(adults, [0, 0, 0], 'the levelled adult row');
  for (const kid of ['r_matthew', 'r_jason', 'r_jessica', 'r_amie']) {
    assert.equal(rowOf(plan, kid), 1, `${kid} should be one row below`);
  }
});

test('children are centred beneath their own parent union and evenly spread', () => {
  const f = fixtureById('nuclear');
  const plan = planOf(f, 'n_dad');
  const kids = ['n_a', 'n_b', 'n_c'].map((id) => plan.positions.get(id).x);
  const parentMid = (plan.positions.get('n_dad').x + plan.positions.get('n_mum').x) / 2;
  const kidMid = (Math.min(...kids) + Math.max(...kids)) / 2;
  assert.ok(Math.abs(kidMid - parentMid) < 1e-6, `centred: kids ${kidMid} vs parents ${parentMid}`);
  const gaps = [kids[1] - kids[0], kids[2] - kids[1]];
  assert.ok(Math.abs(gaps[0] - gaps[1]) < 1e-6, `evenly spread, got gaps ${gaps}`);
  assert.ok(gaps[0] > 0, 'oldest to youngest, left to right');
});

test('a partner pod is rigid — member offsets depend only on the pod', () => {
  const f = fixtureById('remarried');
  const graph = graphOf(f);
  // The Heather/Ken/Christopher pod, viewed from three different selections.
  const offsets = ['r_matthew', 'r_jessica', 'r_gran'].map((activeId) => {
    const plan = planFamilyLayout({ graph, activeId, viewport: VIEWPORT });
    const base = plan.positions.get('r_heather').x;
    return {
      ken: plan.positions.get('r_ken').x - base,
      chris: plan.positions.get('r_chris').x - base,
    };
  });
  for (const o of offsets) {
    assert.deepEqual(o, offsets[0], 'the pod holds the same internal shape from every viewpoint');
  }
});

/* ── The composition guard ───────────────────────────────────────────────── */

test('a distant branch cannot move the near family by even a fraction of a pixel', () => {
  const f = fixtureById('distant-pull');
  const graph = graphOf(f);
  const withFar = planFamilyLayout({ graph, activeId: f.focus, viewport: VIEWPORT });

  // The same family with the entire distant branch removed from the visible set.
  const nearOnly = new Set([...withFar.nearIds]);
  const withoutFar = planFamilyLayout({
    graph, activeId: f.focus, visibleIds: nearOnly, viewport: VIEWPORT,
  });

  for (const id of nearOnly) {
    const a = withFar.positions.get(id);
    const b = withoutFar.positions.get(id);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9,
      `${id} shifted when the distant branch was present: (${a.x},${a.y}) vs (${b.x},${b.y})`);
  }
});

test('an unreachable household is parked, never merged into the active family', () => {
  const f = fixtureById('disconnected');
  const plan = planOf(f);
  const nearXs = [...plan.nearIds].map((id) => plan.positions.get(id).x);
  const nearMax = Math.max(...nearXs);
  const nearMin = Math.min(...nearXs);
  for (const id of ['y_b1', 'y_b2', 'y_b3']) {
    const x = plan.positions.get(id).x;
    assert.ok(x > nearMax || x < nearMin, `${id} was placed inside the active family's span`);
  }
});

/* ── Camera ──────────────────────────────────────────────────────────────── */

test('the camera frames the near family and clamps zoom', () => {
  for (const f of FIXTURES) {
    const plan = planOf(f);
    assert.ok(plan.camera.zoom >= 0.35 - 1e-9 && plan.camera.zoom <= 1.35 + 1e-9,
      `${f.id} zoom ${plan.camera.zoom} out of range`);
    assert.equal(plan.camera.worldX, 0);
    assert.equal(plan.camera.worldY, 0);
  }
});

test('a deep lineage does not shrink the near family to fit distant generations', () => {
  const f = fixtureById('deep-lineage');
  // Selected at the TOP of the lineage, so there are generations below that
  // reach further than the near family does — the case where framing the whole
  // component instead of the near set would visibly shrink everything.
  const plan = planOf(f, 'd_g1');
  const near = [...plan.nearIds];
  const framedRows = near.map((id) => Math.round(plan.positions.get(id).y / ROW_GAP));
  assert.ok(Math.max(...framedRows) <= 2,
    `near set reaches row ${Math.max(...framedRows)} — it should stop at grandchildren`);
  for (const id of ['d_g4', 'd_g5']) {
    assert.ok(!plan.nearIds.has(id), `${id} is beyond the near family and must not be framed`);
  }
  // The whole component spans 5 rows; the near set spans 3. Framing the near
  // set must therefore give a strictly larger zoom than framing everything.
  const allIds = new Set(graphOf(f).people.map((p) => p.id));
  const wholeSpan = (() => {
    const ys = [...allIds].map((id) => plan.positions.get(id).y);
    return Math.max(...ys) - Math.min(...ys);
  })();
  const nearSpan = plan.bounds.maxY - plan.bounds.minY;
  assert.ok(nearSpan < wholeSpan, `near span ${nearSpan} should be tighter than the whole lineage ${wholeSpan}`);
});

test('an explicit anchor is honoured exactly — that is what pins the person on screen', () => {
  const f = fixtureById('nuclear');
  const plan = planOf(f, 'n_a', { anchor: { x: 321, y: 654 } });
  assert.equal(plan.camera.screenX, 321);
  assert.equal(plan.camera.screenY, 654);
});

/* ── Degenerate input ────────────────────────────────────────────────────── */

test('one person alone still produces a valid plan and camera', () => {
  const f = fixtureById('singleton');
  const plan = planOf(f);
  assert.deepEqual(plan.positions.get('s_only'), { x: 0, y: 0 });
  assert.ok(Number.isFinite(plan.camera.zoom) && plan.camera.zoom > 0);
  assert.ok(Number.isFinite(plan.camera.screenX));
});

test('every visible person receives a finite position in every fixture', () => {
  for (const f of FIXTURES) {
    const graph = graphOf(f);
    const plan = planOf(f);
    for (const person of graph.people) {
      const pt = plan.positions.get(person.id);
      assert.ok(pt, `${f.id}: ${person.id} missing`);
      assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y), `${f.id}: ${person.id} non-finite`);
    }
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
