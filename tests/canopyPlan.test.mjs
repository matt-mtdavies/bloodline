/**
 * Canopy layout planner — the constraint suite.
 *
 * Every guarantee in the design is asserted here rather than eyeballed in a
 * browser. That is the entire point of the planner being pure: the things
 * the organic tree could never keep promising (parents above children,
 * partners together, an ex never between a couple) become failing tests the
 * moment they stop being true.
 *
 * Run with: node tests/canopyPlan.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { planCanopy, unitAnchor, ROW_GAP, POD_GAP } from '../src/viz/canopy/plan.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const P = (id, extra = {}) => ({ id, display_name: id, ...extra });
const parent = (from, to, qualifier) => ({ id: `r${from}${to}`, type: 'parent', from_person: from, to_person: to, qualifier });
const partner = (a, b, status = 'current') => ({ id: `p${a}${b}`, type: 'partner', from_person: a, to_person: b, partner_status: status });

/* A deliberately messy family, in the spirit of the app's own seed:
 *   grandparents  GA+GB (paternal)   GC+GD (maternal)
 *   parents       PA+PB
 *   focus row     SIB1(1980) ME(1985) SIB2(1990), ME partnered SP, ex-partner EX
 *   children      C1(2010) C2(2013)
 *   grandchild    GC1 under C1
 */
const people = [
  P('GA', { birth_date: '1920-01-01' }), P('GB', { birth_date: '1922-01-01' }),
  P('GC', { birth_date: '1925-01-01' }), P('GD', { birth_date: '1927-01-01' }),
  P('PA', { birth_date: '1950-01-01' }), P('PB', { birth_date: '1952-01-01' }),
  P('SIB1', { birth_date: '1980-01-01' }), P('ME', { birth_date: '1985-01-01' }), P('SIB2', { birth_date: '1990-01-01' }),
  P('SP', { birth_date: '1986-01-01' }), P('EX', { birth_date: '1984-01-01' }),
  P('C1', { birth_date: '2010-01-01' }), P('C2', { birth_date: '2013-01-01' }),
  P('GC1', { birth_date: '2038-01-01' }),
];
const rels = [
  partner('GA', 'GB'), partner('GC', 'GD'),
  parent('GA', 'PA'), parent('GB', 'PA'),
  parent('GC', 'PB'), parent('GD', 'PB'),
  partner('PA', 'PB'),
  parent('PA', 'SIB1'), parent('PB', 'SIB1'),
  parent('PA', 'ME'), parent('PB', 'ME'),
  parent('PA', 'SIB2'), parent('PB', 'SIB2'),
  partner('ME', 'SP'), partner('ME', 'EX', 'former'),
  parent('ME', 'C1'), parent('SP', 'C1'),
  parent('ME', 'C2'), parent('SP', 'C2'),
  parent('C1', 'GC1'),
];
const graph = buildGraph(people, rels);
const frame = planCanopy(graph, 'ME');
const at = (id) => frame.nodes.get(id);

test('the focus person is exactly at world origin', () => {
  assert.equal(at('ME').x, 0);
  assert.equal(at('ME').y, 0);
});

test('every parent sits strictly above every one of their children', () => {
  for (const r of rels.filter((x) => x.type === 'parent')) {
    const p = at(r.from_person), c = at(r.to_person);
    if (!p || !c) continue; // not both in frame — nothing to assert
    assert.ok(p.y < c.y, `${r.from_person} (y=${p.y}) must be above ${r.to_person} (y=${c.y})`);
  }
});

test('current partners share one rigid pod, exactly POD_GAP apart', () => {
  const me = at('ME'), sp = at('SP');
  assert.equal(me.unitId, sp.unitId, 'ME and SP must be in the same unit');
  assert.equal(Math.abs(sp.x - me.x), POD_GAP);
  assert.equal(me.y, sp.y, 'a pod is level by construction');
});

test('a former partner is a separate unit, never between the current couple', () => {
  const me = at('ME'), sp = at('SP'), ex = at('EX');
  assert.notEqual(ex.unitId, me.unitId, 'the ex must not be a pod member');
  const lo = Math.min(me.x, sp.x), hi = Math.max(me.x, sp.x);
  assert.ok(ex.x < lo || ex.x > hi, `ex at ${ex.x} must be outside the couple's span ${lo}..${hi}`);
});

test('a former partner sits on the OPPOSITE side of the focus from the current one', () => {
  /* Supersedes an earlier rule that put the ex outboard of the current pod.
   * That satisfied "never between the couple" but created a worse defect: a
   * child's branch anchors on the midpoint between their two real parents,
   * and with the ex outboard that midpoint landed squarely on the current
   * partner — so two boys' line to their own mother and father appeared to
   * descend out of their mother's new husband. Past on one side, present on
   * the other, gives every union its own side and its own midpoint. */
  const me = at('ME').x, sp = at('SP').x, ex = at('EX').x;
  assert.ok(Math.sign(ex - me) !== Math.sign(sp - me),
    `ex at ${ex} and current partner at ${sp} must be on opposite sides of the focus at ${me}`);
  // Still never between the focus and their current partner.
  const lo = Math.min(me, sp), hi = Math.max(me, sp);
  assert.ok(ex < lo || ex > hi, 'the ex is never inside the current couple');
});

test('a union anchor never lands on a third person', () => {
  /* The mechanical version of the bug above: for every descent, the midpoint
   * of the real parents must not sit on top of somebody else on that row. */
  const f = planCanopy(graph, 'ME');
  for (const b of f.bonds.filter((x) => x.kind === 'descent')) {
    const via = (b.viaIds && b.viaIds.length ? b.viaIds : [])
      .map((id) => f.nodes.get(id)).filter(Boolean);
    if (via.length < 2) continue;
    const mid = (Math.min(...via.map((n) => n.x)) + Math.max(...via.map((n) => n.x))) / 2;
    const row = via[0].row;
    for (const n of f.nodes.values()) {
      if (n.row !== row || via.some((v) => v.id === n.id)) continue;
      assert.ok(Math.abs(n.x - mid) > n.r,
        `${n.id} sits on the union anchor for ${b.child} (anchor ${mid.toFixed(0)}, them ${n.x.toFixed(0)})`);
    }
  }
});

test('siblings share the focus row, in birth order across it', () => {
  assert.equal(at('SIB1').y, at('ME').y);
  assert.equal(at('SIB2').y, at('ME').y);
  // SIB1 (1980) is elder → left of ME; SIB2 (1990) is younger → right.
  assert.ok(at('SIB1').x < at('ME').x, 'the elder sibling is to the left');
  assert.ok(at('SIB2').x > at('ME').x, 'the younger sibling is to the right');
});

test('children are one row below and centred under their parents’ union', () => {
  const c1 = at('C1'), c2 = at('C2');
  assert.equal(c1.y, ROW_GAP);
  assert.equal(c2.y, ROW_GAP);
  const podMid = (at('ME').x + at('SP').x) / 2;
  const childMid = (c1.x + c2.x) / 2;
  assert.ok(Math.abs(childMid - podMid) < 0.001, `children centre ${childMid} should match union ${podMid}`);
});

test('children are ordered eldest to youngest left to right', () => {
  assert.ok(at('C1').x < at('C2').x);
});

test('the parent unit is centred over the span of its drawn children', () => {
  const kids = ['SIB1', 'ME', 'SIB2'].map((id) => at(id));
  const lo = Math.min(...kids.map((k) => k.x));
  // ME's pod extends right to SP, and SP is not PA/PB's child — the span the
  // parents centre over is the CHILDREN's own span, which ends at SIB2.
  const hi = Math.max(...kids.map((k) => k.x));
  const parentMid = (at('PA').x + at('PB').x) / 2;
  assert.ok(parentMid > lo && parentMid < hi, `parent midpoint ${parentMid} should sit within ${lo}..${hi}`);
});

test('grandparents sit two rows up, as pods, one per parent', () => {
  for (const id of ['GA', 'GB', 'GC', 'GD']) assert.equal(at(id).y, -2 * ROW_GAP);
  assert.equal(at('GA').unitId, at('GB').unitId);
  assert.equal(at('GC').unitId, at('GD').unitId);
  assert.notEqual(at('GA').unitId, at('GC').unitId);
});

test('units on a row never overlap', () => {
  for (const [, rowUnits] of frame.rows) {
    const sorted = [...rowUnits].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      const prevRight = prev.x + Math.max(...prev.memberIds.map((m) => prev.offsets.get(m)));
      const curLeft = cur.x + Math.min(...cur.memberIds.map((m) => cur.offsets.get(m)));
      assert.ok(curLeft > prevRight, `units ${prev.id} and ${cur.id} overlap on row ${cur.row}`);
    }
  }
});

test('fidelity bands fall off with kinship, and the focus is full size', () => {
  assert.equal(at('ME').band, 'hearth');
  assert.equal(at('C1').band, 'hearth');
  assert.equal(at('SIB1').band, 'kin');
  assert.equal(at('PA').band, 'kin');
  assert.equal(at('GA').band, 'reach');
  assert.ok(at('GA').r < at('SIB1').r && at('SIB1').r < at('ME').r);
});

test('deterministic — same input yields byte-identical output', () => {
  const a = planCanopy(graph, 'ME');
  const b = planCanopy(graph, 'ME');
  const ser = (f) => JSON.stringify([...f.nodes.entries()].sort((x, y) => x[0].localeCompare(y[0])));
  assert.equal(ser(a), ser(b));
});

test('a union anchor is the midpoint of its pod, for both anchoring styles', () => {
  const focusAnchor = unitAnchor(frame, at('ME').unitId);
  assert.ok(Math.abs(focusAnchor.x - (at('ME').x + at('SP').x) / 2) < 0.001, 'focus pod (anchored on first member)');
  const parentAnchor = unitAnchor(frame, at('PA').unitId);
  assert.ok(Math.abs(parentAnchor.x - (at('PA').x + at('PB').x) / 2) < 0.001, 'parent pod (centred)');
});

test('horizon marks carry a real count of what is not drawn', () => {
  // SIB1 and SIB2 have no descendants, so no downward horizon for them.
  const sibHorizons = frame.horizons.filter((h) => h.dir === 'down' && h.unitId === at('SIB1').unitId);
  assert.equal(sibHorizons.length, 0, 'no horizon where there is nothing beyond');
  // GC1 is drawn, so C1's own line is fully shown at this depth.
  assert.ok(frame.horizons.every((h) => h.count > 0), 'a horizon is never drawn with a count of zero');
});

/* ── Every state designed: the sparse and awkward shapes ───────────────── */

test('a person with no relationships at all still plans a valid frame', () => {
  const g = buildGraph([P('ALONE')], []);
  const f = planCanopy(g, 'ALONE');
  assert.equal(f.nodes.size, 1);
  assert.equal(f.nodes.get('ALONE').x, 0);
  assert.equal(f.nodes.get('ALONE').y, 0);
});

test('an unknown focus id returns an empty frame rather than throwing', () => {
  const f = planCanopy(graph, 'NOBODY');
  assert.equal(f.nodes.size, 0);
  assert.deepEqual(f.bounds, { minX: 0, maxX: 0, minY: 0, maxY: 0 });
});

test('a single parent is drawn alone, not forced into a misleading pod', () => {
  const g = buildGraph([P('K'), P('M')], [parent('M', 'K')]);
  const f = planCanopy(g, 'K');
  assert.equal(f.nodes.get('M').y, -ROW_GAP);
  assert.notEqual(f.nodes.get('M').unitId, f.nodes.get('K').unitId);
});

test('two parents who were never partners each get their own unit', () => {
  const g = buildGraph([P('K'), P('M'), P('F')], [parent('M', 'K'), parent('F', 'K')]);
  const f = planCanopy(g, 'K');
  assert.notEqual(f.nodes.get('M').unitId, f.nodes.get('F').unitId);
  assert.equal(f.nodes.get('M').y, f.nodes.get('F').y, 'both still belong on the parent row');
});

test('a person with three partners keeps current partners podded and the ex out', () => {
  const g = buildGraph(
    [P('H'), P('W1', { birth_date: '1970-01-01' }), P('W2', { birth_date: '1975-01-01' }), P('XW', { birth_date: '1965-01-01' })],
    [partner('H', 'W1'), partner('H', 'W2'), partner('H', 'XW', 'former')],
  );
  const f = planCanopy(g, 'H');
  const u = f.nodes.get('H').unitId;
  assert.equal(f.nodes.get('W1').unitId, u);
  assert.equal(f.nodes.get('W2').unitId, u);
  assert.notEqual(f.nodes.get('XW').unitId, u);
  const podXs = ['H', 'W1', 'W2'].map((id) => f.nodes.get(id).x);
  const ex = f.nodes.get('XW').x;
  assert.ok(ex < Math.min(...podXs) || ex > Math.max(...podXs));
});

test('a childless, parentless couple still centres the focus at origin', () => {
  const g = buildGraph([P('A'), P('B')], [partner('A', 'B')]);
  const f = planCanopy(g, 'A');
  assert.equal(f.nodes.get('A').x, 0);
  assert.equal(f.nodes.get('B').x, POD_GAP);
});

test('nobody is ever drawn twice, in any shape', () => {
  for (const focusId of ['ME', 'PA', 'GA', 'C1', 'SP', 'EX', 'GC1']) {
    const f = planCanopy(graph, focusId);
    const seen = new Set();
    for (const u of f.units) {
      for (const m of u.memberIds) {
        assert.ok(!seen.has(m), `${m} drawn twice when focused on ${focusId}`);
        seen.add(m);
      }
    }
    assert.equal(f.nodes.get(focusId).x, 0, `focus ${focusId} must be at origin`);
    assert.equal(f.nodes.get(focusId).y, 0);
  }
});

test('every bond references people who are actually in the frame', () => {
  for (const focusId of ['ME', 'PA', 'C1', 'GC1']) {
    const f = planCanopy(graph, focusId);
    for (const b of f.bonds) {
      if (b.kind === 'union') {
        assert.ok(f.nodes.has(b.a) && f.nodes.has(b.b), `union bond to someone off-frame (focus ${focusId})`);
      } else {
        assert.ok(f.nodes.has(b.child), `descent bond to an undrawn child (focus ${focusId})`);
        const unit = f.units.find((u) => u.id === b.parentUnit);
        assert.ok(unit, `descent bond from an undrawn unit (focus ${focusId})`);
        const parentIds = unit.anchorMemberIds?.length ? unit.anchorMemberIds : unit.memberIds;
        for (const id of parentIds) {
          assert.ok(f.nodes.has(id), `descent anchor references undrawn parent ${id} (focus ${focusId})`);
        }
      }
    }
  }
});

const parentIdsForBond = (f, childId) => {
  const bond = f.bonds.find((b) => b.kind === 'descent' && b.child === childId);
  assert.ok(bond, `expected a descent bond for ${childId}`);
  const unit = f.units.find((u) => u.id === bond.parentUnit);
  assert.ok(unit, `expected parent junction ${bond.parentUnit}`);
  return [...(unit.anchorMemberIds?.length ? unit.anchorMemberIds : unit.memberIds)].sort();
};

test('a selected child shows both exact parents, never a parent’s new partner', () => {
  const g = buildGraph(
    [P('CHRIS'), P('HEATHER'), P('DENISE'), P('MATTHEW'), P('JASON')],
    [
      partner('CHRIS', 'HEATHER', 'former'),
      partner('CHRIS', 'DENISE'),
      parent('CHRIS', 'MATTHEW'), parent('HEATHER', 'MATTHEW'),
      parent('CHRIS', 'JASON'), parent('HEATHER', 'JASON'),
    ],
  );
  const f = planCanopy(g, 'JASON', { includeReach: false });
  assert.ok(f.nodes.has('CHRIS') && f.nodes.has('HEATHER'), 'both recorded parents are visible');
  assert.deepEqual(parentIdsForBond(f, 'JASON'), ['CHRIS', 'HEATHER']);
  assert.ok(!parentIdsForBond(f, 'JASON').includes('DENISE'), 'the new partner is not promoted to parent');
});

test('half siblings descend from their own exact parent set', () => {
  const g = buildGraph(
    [P('A'), P('B'), P('C'), P('ME'), P('HALF')],
    [
      partner('A', 'B'), partner('A', 'C', 'former'),
      parent('A', 'ME'), parent('B', 'ME'),
      parent('A', 'HALF'), parent('C', 'HALF'),
    ],
  );
  const f = planCanopy(g, 'ME', { includeReach: false });
  assert.deepEqual(parentIdsForBond(f, 'ME'), ['A', 'B']);
  assert.deepEqual(parentIdsForBond(f, 'HALF'), ['A', 'C']);
  assert.ok(f.nodes.has('C'), 'the half sibling’s other parent is visible as context');
});

test('children from different partners use different parental junctions', () => {
  const g = buildGraph(
    [P('ME'), P('P1'), P('P2'), P('C1'), P('C2')],
    [
      partner('ME', 'P1'), partner('ME', 'P2'),
      parent('ME', 'C1'), parent('P1', 'C1'),
      parent('ME', 'C2'), parent('P2', 'C2'),
    ],
  );
  const f = planCanopy(g, 'ME', { includeReach: false });
  assert.deepEqual(parentIdsForBond(f, 'C1'), ['ME', 'P1']);
  assert.deepEqual(parentIdsForBond(f, 'C2'), ['ME', 'P2']);
  const bonds = f.bonds.filter((b) => b.kind === 'descent' && ['C1', 'C2'].includes(b.child));
  assert.notEqual(bonds[0].parentUnit, bonds[1].parentUnit, 'each partnership owns its own branch');
});

test('every visible descent is backed by the child’s recorded parent edges', () => {
  const shapes = [frame, planCanopy(graph, 'PA'), planCanopy(graph, 'C1')];
  for (const f of shapes) {
    for (const b of f.bonds.filter((x) => x.kind === 'descent')) {
      const actual = new Set(graph.parents(b.child).map((p) => p.id));
      const u = f.units.find((x) => x.id === b.parentUnit);
      const shown = u.anchorMemberIds?.length ? u.anchorMemberIds : u.memberIds;
      for (const id of shown) assert.ok(actual.has(id), `${id} is not a recorded parent of ${b.child}`);
    }
  }
});

test('planned visual footprints on a row do not overlap', () => {
  const long = buildGraph(
    [
      P('A', { display_name: 'Christopher Monish-Davies' }),
      P('B', { display_name: 'Denise Sutcliffe-Montgomery' }),
      P('C', { display_name: 'Jason Alexander Davies' }),
    ],
    [partner('A', 'B'), parent('A', 'C'), parent('B', 'C')],
  );
  const f = planCanopy(long, 'A', { includeReach: false });
  const row = [...f.nodes.values()].filter((n) => n.row === 0).sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1], cur = row[i];
    assert.ok(
      prev.x + Math.max(prev.r, prev.labelHalfWidth) + 20
        <= cur.x - Math.max(cur.r, cur.labelHalfWidth),
      `${prev.id} and ${cur.id} label footprints overlap`,
    );
  }
});

/* ── The narrow frame (phone) ──────────────────────────────────────────── */

test('dropping Reach removes grandparents and grandchildren, nothing else', () => {
  const f = planCanopy(graph, 'ME', { includeReach: false });
  for (const id of ['GA', 'GB', 'GC', 'GD', 'GC1']) {
    assert.ok(!f.nodes.has(id), `${id} should not be drawn in a narrow frame`);
  }
  // Everything Hearth and Kin is still there.
  for (const id of ['ME', 'SP', 'EX', 'SIB1', 'SIB2', 'PA', 'PB', 'C1', 'C2']) {
    assert.ok(f.nodes.has(id), `${id} must still be drawn`);
  }
  assert.equal(f.nodes.get('ME').x, 0);
  assert.equal(f.nodes.get('ME').y, 0);
});

test('a narrow frame STATES what it dropped rather than just stopping', () => {
  const f = planCanopy(graph, 'ME', { includeReach: false });
  const parentUnit = f.units.find((u) => u.anchorMemberIds?.includes('PA') && u.anchorMemberIds?.includes('PB'));
  const up = f.horizons.find((h) => h.unitId === parentUnit?.id && h.dir === 'up');
  assert.ok(up, 'the parent unit carries an upward horizon');
  assert.equal(up.count, 4, 'all four grandparents are accounted for');
  // C1 has a child (GC1) who is no longer drawn — that must be stated too.
  const c1Unit = f.nodes.get('C1').unitId;
  const down = f.horizons.find((h) => h.unitId === c1Unit && h.dir === 'down');
  assert.ok(down && down.count === 1, 'C1 carries a downward horizon for GC1');
});

test('a narrow frame is genuinely narrower than a wide one', () => {
  const wide = planCanopy(graph, 'ME');
  const narrow = planCanopy(graph, 'ME', { includeReach: false });
  const w = (f) => f.bounds.maxX - f.bounds.minX;
  const h = (f) => f.bounds.maxY - f.bounds.minY;
  assert.ok(w(narrow) <= w(wide), 'no wider');
  assert.ok(h(narrow) < h(wide), 'and genuinely shorter — two fewer rows');
});

test('a narrow frame is deterministic too', () => {
  const ser = (f) => JSON.stringify([...f.nodes.entries()].sort((x, y) => x[0].localeCompare(y[0])));
  assert.equal(
    ser(planCanopy(graph, 'ME', { includeReach: false })),
    ser(planCanopy(graph, 'ME', { includeReach: false })),
  );
});

/* ── Union blocks ─────────────────────────────────────────────────────────
 * The exact shape reported against the owner's real tree: Heather's sons are
 * by Chris; her step-daughters are Ken's. All four sat on one row as
 * "Jessica, Matthew, Amie, Jason" — interleaved, with branches crossing.
 */
const blended = buildGraph(
  [
    P('HEATHER', { display_name: 'Heather Davies', birth_date: '1959-01-01' }),
    P('CHRIS', { display_name: 'Christopher Monish-Davies', birth_date: '1958-01-01' }),
    P('KEN', { display_name: 'Ken Threlfall', birth_date: '1956-01-01' }),
    P('MATT', { display_name: 'Matthew Davies', birth_date: '1980-01-01' }),
    P('JASON', { display_name: 'Jason Davies', birth_date: '1982-01-01' }),
    P('JESS', { display_name: 'Jessica Lamb', birth_date: '1983-01-01' }),
    P('AMIE', { display_name: 'Amie Franklin', birth_date: '1985-01-01' }),
  ],
  [
    partner('CHRIS', 'HEATHER', 'former'), partner('HEATHER', 'KEN'),
    parent('CHRIS', 'MATT'), parent('HEATHER', 'MATT'),
    parent('CHRIS', 'JASON'), parent('HEATHER', 'JASON'),
    parent('KEN', 'JESS'), parent('HEATHER', 'JESS', 'step'),
    parent('KEN', 'AMIE'), parent('HEATHER', 'AMIE', 'step'),
  ],
);

test("two unions' children never interleave — each union is one block", () => {
  const f = planCanopy(blended, 'HEATHER');
  const groupOf = (id) => f.bonds.find((b) => b.kind === 'descent' && b.child === id)?.parentUnit;
  const row = ['MATT', 'JASON', 'JESS', 'AMIE']
    .map((id) => ({ id, x: f.nodes.get(id).x, g: groupOf(id) }))
    .sort((a, b) => a.x - b.x);
  // Walking the row left to right, each union's block must appear once and
  // then be finished with — never returned to.
  const seen = [];
  for (const p of row) if (seen[seen.length - 1] !== p.g) seen.push(p.g);
  assert.equal(new Set(seen).size, seen.length,
    `blocks interleave: ${row.map((p) => p.id).join(', ')}`);
});

test('siblings from one union stay adjacent to each other', () => {
  const f = planCanopy(blended, 'HEATHER');
  const row = ['MATT', 'JASON', 'JESS', 'AMIE']
    .map((id) => ({ id, x: f.nodes.get(id).x }))
    .sort((a, b) => a.x - b.x)
    .map((p) => p.id);
  const iMatt = row.indexOf('MATT'), iJason = row.indexOf('JASON');
  const iJess = row.indexOf('JESS'), iAmie = row.indexOf('AMIE');
  assert.equal(Math.abs(iMatt - iJason), 1, `the brothers are split: ${row.join(', ')}`);
  assert.equal(Math.abs(iJess - iAmie), 1, `the sisters are split: ${row.join(', ')}`);
});

test('a block is separated from its neighbour by more than a sibling gap', () => {
  /* The gap is the only thing that says "these four are two families". */
  const f = planCanopy(blended, 'HEATHER');
  const row = ['MATT', 'JASON', 'JESS', 'AMIE']
    .map((id) => ({ id, x: f.nodes.get(id).x }))
    .sort((a, b) => a.x - b.x);
  const groupOf = (id) => f.bonds.find((b) => b.kind === 'descent' && b.child === id)?.parentUnit;
  let withinMax = 0, betweenMin = Infinity;
  for (let i = 1; i < row.length; i++) {
    const d = row[i].x - row[i - 1].x;
    if (groupOf(row[i].id) === groupOf(row[i - 1].id)) withinMax = Math.max(withinMax, d);
    else betweenMin = Math.min(betweenMin, d);
  }
  assert.ok(betweenMin > withinMax,
    `between-block gap ${betweenMin.toFixed(0)} must exceed within-block ${withinMax.toFixed(0)}`);
});

test('the blocks sit under the unions that produced them, not off to one side', () => {
  const f = planCanopy(blended, 'HEATHER');
  const centre = (ids) => ids.reduce((s, id) => s + f.nodes.get(id).x, 0) / ids.length;
  // Chris's block and Ken's block must land on opposite sides of each other
  // in the same order their parents do.
  const chrisSide = f.nodes.get('CHRIS').x;
  const kenSide = f.nodes.get('KEN').x;
  const boys = centre(['MATT', 'JASON']);
  const girls = centre(['JESS', 'AMIE']);
  assert.equal(Math.sign(boys - girls), Math.sign(chrisSide - kenSide),
    'the blocks are ordered the same way their parents are — otherwise branches cross');
});

test('blocks stay deterministic', () => {
  const a = planCanopy(blended, 'HEATHER');
  const b = planCanopy(blended, 'HEATHER');
  const ser = (f) => JSON.stringify([...f.nodes.entries()].map(([k, v]) => [k, v.x, v.y]).sort());
  assert.equal(ser(a), ser(b));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
