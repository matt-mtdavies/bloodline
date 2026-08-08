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
import { planFamilyLayout, ROW_GAP, POD_GAP, UNIT_GAP, NODE_RADIUS } from '../src/viz/v2/layoutPlanner.js';

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

/* ── P1 fixes from the Codex review of PR #130 ───────────────────────────── */

test('P1 fix: a transitive partner chain does NOT collapse into one pod', () => {
  // A–B and C–D are direct partnerships; B–C is a separate one. Full
  // transitive closure over the whole partner graph used to merge all four
  // into one giant rigid pod just because B and C each have two partners.
  const f = fixtureById('partner-chain');
  const plan = planOf(f); // active = ch_a
  const unitA = plan.unitOf.get('ch_a');
  const unitC = plan.unitOf.get('ch_c');
  assert.notEqual(unitA.id, unitC.id, 'ch_a/ch_b and ch_c/ch_d must land in separate pods');
  assert.deepEqual([...unitA.memberIds].sort(), ['ch_a', 'ch_b']);
  assert.deepEqual([...unitC.memberIds].sort(), ['ch_c', 'ch_d']);
});

test('P1 fix: the chain splits the same way regardless of which end is active', () => {
  const f = fixtureById('partner-chain');
  const graph = graphOf(f);
  const planFromA = planFamilyLayout({ graph, activeId: 'ch_a', viewport: VIEWPORT });
  const planFromD = planFamilyLayout({ graph, activeId: 'ch_d', viewport: VIEWPORT });
  const membersOf = (plan, id) => [...plan.unitOf.get(id).memberIds].sort();
  assert.deepEqual(membersOf(planFromA, 'ch_a'), membersOf(planFromD, 'ch_a'));
  assert.deepEqual(membersOf(planFromA, 'ch_c'), membersOf(planFromD, 'ch_c'));
});

test('P1 fix: near family includes EVERY pod member\'s own parents and children, not just the active person\'s', () => {
  // A real report: Christopher's parents and Ken's children were pushed
  // beyond the near family's span in the very fixture built to show them —
  // near-family traversal only ever walked out from the active person, not
  // from their partners too.
  const f = fixtureById('remarried');
  const plan = planOf(f); // active = r_heather; pod = {heather, ken, chris}
  assert.ok(plan.nearIds.has('r_gran'), "Christopher's mother must be near");
  assert.ok(plan.nearIds.has('r_grandad'), "Christopher's father must be near");
  assert.ok(plan.nearIds.has('r_jessica'), "Ken's daughter must be near");
  assert.ok(plan.nearIds.has('r_amie'), "Ken's daughter must be near");
});

/* ── P2 fixes from the Codex review of PR #130 ───────────────────────────── */

test('P2 fix: co-parents without a partner edge are packed together, not scattered', () => {
  // Dorothy and Francis are both Christopher's parents but were never
  // partnered in the data — a real, legitimate shape. Only the first one
  // used to get placed at all; the second fell through to "everyone else"
  // and could land anywhere, including outside the near family's own span.
  const f = fixtureById('remarried');
  const plan = planOf(f); // active = r_heather
  assert.equal(rowOf(plan, 'r_gran'), rowOf(plan, 'r_grandad'), 'both co-parents share a row');
  const gran = plan.positions.get('r_gran');
  const grandad = plan.positions.get('r_grandad');
  const gap = Math.abs(gran.x - grandad.x);
  assert.ok(gap <= UNIT_GAP + POD_GAP,
    `co-parents are ${gap}px apart — should be packed side by side, not scattered`);
  assert.ok(plan.nearIds.has('r_gran') && plan.nearIds.has('r_grandad'), 'both must be near, not outside');
});

test('P2 fix: three-way co-parent scattering — every distinct unit is actually PLACED near its co-parent, at every generation', () => {
  // The active person's own two parents are themselves unpartnered
  // co-parents (the "step 3" case), and each of THEM has a different,
  // unpartnered co-parent of their own (the "step 4" case) — four distinct
  // grandparent-generation people, none of them couples. Checks actual
  // PLACEMENT (not just row/near-membership, which the near-family fix
  // alone already guarantees regardless of whether this placement fix
  // exists) — a weaker version of this test that checked only those two
  // things passed even against the unfixed planner.
  const f = {
    id: 'four-way-grandparents',
    people: [
      { id: 'z_me', display_name: 'Me', birth_date: '1990' },
      { id: 'z_dad', display_name: 'Dad', birth_date: '1960' },
      { id: 'z_mum', display_name: 'Mum', birth_date: '1962' },
      { id: 'z_gd1', display_name: "Dad's father", birth_date: '1935' },
      { id: 'z_gd2', display_name: "Dad's mother", birth_date: '1937' },
      { id: 'z_gm1', display_name: "Mum's father", birth_date: '1934' },
      { id: 'z_gm2', display_name: "Mum's mother", birth_date: '1936' },
    ],
    relationships: [
      { type: 'parent', from_person: 'z_dad', to_person: 'z_me', qualifier: 'biological', partner_status: null },
      { type: 'parent', from_person: 'z_mum', to_person: 'z_me', qualifier: 'biological', partner_status: null },
      { type: 'parent', from_person: 'z_gd1', to_person: 'z_dad', qualifier: 'biological', partner_status: null },
      { type: 'parent', from_person: 'z_gd2', to_person: 'z_dad', qualifier: 'biological', partner_status: null },
      { type: 'parent', from_person: 'z_gm1', to_person: 'z_mum', qualifier: 'biological', partner_status: null },
      { type: 'parent', from_person: 'z_gm2', to_person: 'z_mum', qualifier: 'biological', partner_status: null },
    ],
    focus: 'z_me',
  };
  const plan = planOf(f);
  const gapOf = (a, b) => Math.abs(plan.positions.get(a).x - plan.positions.get(b).x);

  // Step 3: the active person's own two unpartnered parents.
  assert.equal(rowOf(plan, 'z_dad'), rowOf(plan, 'z_mum'));
  assert.ok(gapOf('z_dad', 'z_mum') <= UNIT_GAP + POD_GAP,
    `z_dad/z_mum are ${gapOf('z_dad', 'z_mum')}px apart — should be packed together`);

  // Step 4: each parent's own unpartnered co-parent.
  assert.equal(rowOf(plan, 'z_gd1'), rowOf(plan, 'z_gd2'));
  assert.ok(gapOf('z_gd1', 'z_gd2') <= UNIT_GAP + POD_GAP,
    `z_gd1/z_gd2 are ${gapOf('z_gd1', 'z_gd2')}px apart — should be packed together`);
  assert.equal(rowOf(plan, 'z_gm1'), rowOf(plan, 'z_gm2'));
  assert.ok(gapOf('z_gm1', 'z_gm2') <= UNIT_GAP + POD_GAP,
    `z_gm1/z_gm2 are ${gapOf('z_gm1', 'z_gm2')}px apart — should be packed together`);

  for (const id of ['z_gd1', 'z_gd2', 'z_gm1', 'z_gm2']) {
    assert.ok(plan.nearIds.has(id), `${id} must be near, not scattered outside`);
  }
});

test('P2 fix: two independently-packed groups on the same row never overlap', () => {
  // Ken's kids and Chris+Heather's kids in the "remarried" fixture are two
  // DIFFERENT groups, each individually well-spaced within itself by
  // packRow — but nothing checked whether the two independently-chosen
  // group centres left enough room BETWEEN the groups. A real reported
  // consequence: two people from different groups ended up close enough to
  // visually overlap in the settled composition itself, not just during a
  // transition — the live overlay showed collision routinely maxing out
  // its clamp trying (and still failing) to fully separate them.
  for (const f of FIXTURES) {
    const graph = graphOf(f);
    for (const person of graph.people) {
      const plan = planFamilyLayout({ graph, activeId: person.id, viewport: VIEWPORT });
      const byRow = new Map();
      for (const [id, pt] of plan.positions) {
        const r = Math.round(pt.y / ROW_GAP);
        if (!byRow.has(r)) byRow.set(r, []);
        byRow.get(r).push({ id, x: pt.x });
      }
      for (const [r, entries] of byRow) {
        entries.sort((a, b) => a.x - b.x);
        for (let i = 1; i < entries.length; i++) {
          const gap = entries[i].x - entries[i - 1].x;
          assert.ok(gap >= 2 * NODE_RADIUS - 1e-6,
            `${f.id} (active ${person.id}) row ${r}: ${entries[i - 1].id} and ${entries[i].id} only ${gap.toFixed(1)}px apart`);
        }
      }
    }
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

test('P2 fix: the planner behaves correctly across mobile/tablet/wide viewports, not just one fixed size', () => {
  // The lab UI hardcodes one 980x620 stage, and every other test in this
  // file uses one fixed 1200x800 VIEWPORT — so nothing had ever exercised
  // planFamilyLayout/the camera at a genuinely different aspect ratio or
  // size. This proves the PURE layout/camera math (not the lab's CSS,
  // which is out of scope for a fixture-only bench) holds its invariants
  // across a real spread: a narrow phone portrait, a tablet, and a wide
  // desktop.
  const VIEWPORTS = {
    'mobile portrait 390x844': { width: 390, height: 844 },
    'tablet 768x1024': { width: 768, height: 1024 },
    'wide desktop 1440x900': { width: 1440, height: 900 },
  };
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    for (const f of FIXTURES) {
      const graph = graphOf(f);
      const plan = planFamilyLayout({ graph, activeId: f.focus, viewport });
      // Same invariants as "every visible person receives a finite
      // position" and "the camera frames the near family and clamps zoom"
      // above, just swept across every viewport instead of one.
      for (const person of graph.people) {
        const pt = plan.positions.get(person.id);
        assert.ok(pt, `${label}/${f.id}: ${person.id} missing`);
        assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y),
          `${label}/${f.id}: ${person.id} non-finite`);
      }
      assert.ok(plan.camera.zoom >= 0.35 - 1e-9 && plan.camera.zoom <= 1.35 + 1e-9,
        `${label}/${f.id}: zoom ${plan.camera.zoom} out of range`);
      assert.ok(Number.isFinite(plan.camera.screenX) && Number.isFinite(plan.camera.screenY),
        `${label}/${f.id}: non-finite camera screen position`);
      // The active person must always land inside the actual viewport
      // bounds passed in — a narrow phone width is exactly the case where
      // a camera computed for a wide desktop would clip the very person
      // the whole view is supposed to be anchored on.
      assert.ok(plan.camera.screenX >= 0 && plan.camera.screenX <= viewport.width,
        `${label}/${f.id}: active person's screenX ${plan.camera.screenX} is outside the ${viewport.width}px-wide viewport`);
      assert.ok(plan.camera.screenY >= 0 && plan.camera.screenY <= viewport.height,
        `${label}/${f.id}: active person's screenY ${plan.camera.screenY} is outside the ${viewport.height}px-tall viewport`);
    }
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
