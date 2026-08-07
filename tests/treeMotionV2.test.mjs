/**
 * Integrated motion tests for the V2 engine.
 *
 * These deliberately do NOT test a force in isolation. Every V1 problem that
 * reached a user was a composite failure — each part behaved on its own and the
 * combination did not — so every assertion here drives the real engine through
 * a real transition, frame by frame, with layout, springs, collision, ambient
 * motion and the camera all live at once, and judges what a viewer would
 * actually have seen.
 *
 * Run with: node tests/treeMotionV2.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { FIXTURES, fixtureById } from '../src/viz/v2/fixtures.js';
import { createMotionEngine } from '../src/viz/v2/engine.js';
import { createLegacyEngine } from '../src/viz/v2/legacyEngine.js';
import { toScreen, ROW_GAP } from '../src/viz/v2/layoutPlanner.js';
import { MAX_PUSH, LocalCollision } from '../src/viz/v2/collision.js';
import { stepSpring, omegaForSettleTime } from '../src/viz/v2/springs.js';
import { PASS_FAIL_THRESHOLDS, verdict } from '../src/viz/v2/metrics.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const VIEWPORT = { width: 1200, height: 800 };
const FRAME = 16.667;
const engineFor = (fixtureId, opts = {}) => {
  const f = fixtureById(fixtureId);
  const graph = buildGraph(f.people, f.relationships);
  const engine = createMotionEngine({ graph, viewport: VIEWPORT, ...opts });
  engine.select(f.focus);
  return { engine, graph, fixture: f };
};

/* ── The headline invariant, driven through real frames ──────────────────── */

test('the selected person does not move on screen for a single frame of a transition', () => {
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT });
    engine.select(f.focus);
    // Walk the whole fixture, selecting each person in turn — the transition
    // between two arbitrary compositions is where drift would show up.
    for (const person of graph.people) {
      engine.resetMetrics(`select:${person.id}`);
      const before = engine.screenPositions().get(person.id);
      engine.select(person.id, { anchor: before });
      let frames = 0;
      while (!engine.isSettled() && frames < 400) {
        engine.step(FRAME);
        const now = engine.screenPositions().get(person.id);
        assert.ok(Math.abs(now.x - before.x) < 1e-6 && Math.abs(now.y - before.y) < 1e-6,
          `${f.id}: ${person.id} drifted to (${now.x},${now.y}) from (${before.x},${before.y}) on frame ${frames}`);
        frames++;
      }
      const summary = engine.summary();
      assert.equal(summary.maxActiveDriftPx, 0, `${f.id}/${person.id} recorded drift`);
    }
  }
});

test('P1 fix: selecting someone new does not jump everyone ELSE on screen', () => {
  // A real report from live capture: selecting Matthew in the "remarried"
  // fixture held Matthew within ~0.14px (the pre-existing invariant above)
  // while most of the rest of the family jumped ~47px and Jason jumped
  // ~129px — instantly, before a single frame of easing, because the
  // coordinate frame's own origin moved without rebasing anyone already on
  // screen. maxActiveDriftPx never saw it: it only ever tracked the ACTIVE
  // person. This drives the transition with ambient/collision off so the
  // only thing that can move anyone is the coordinate-frame change itself.
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT, ambient: false, collision: false });
    engine.select(f.focus);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    for (const person of graph.people) {
      if (person.id === f.focus) continue;
      const before = engine.screenPositions();
      engine.select(person.id);
      const after = engine.screenPositions();
      let checked = 0;
      for (const [id, pt] of before) {
        const a2 = after.get(id);
        if (!a2) continue;
        checked++;
        const d = Math.hypot(pt.x - a2.x, pt.y - a2.y);
        assert.ok(d < 1,
          `${f.id}: selecting ${person.id} jumped ${id} by ${d.toFixed(2)}px at the instant of selection`);
      }
      assert.ok(checked > 0, `${f.id}: nobody to check the jump against`);
    }
  }
});

test('P1 fix: the same holds true with ambient breathing and collision left ON (the real defaults)', () => {
  // The isolated test above proves the coordinate rebase itself is exact.
  // This proves it holds up once the OTHER two live pieces are back in the
  // picture too — a second real bug lived exactly here: the rebase amount
  // was computed from the newly active person's bare spring value, which
  // silently dropped their OWN collision displacement and ambient breath
  // contribution, leaving a several-pixel residual for everyone else even
  // after the primary coordinate fix above.
  //
  // One SEPARATE, genuinely irreducible source of a small jump remains and
  // is deliberately allowed for here rather than chased further: the person
  // who was JUST active breathes exactly zero right up until the instant
  // they stop being active, at which point their suppressed sine phase
  // (which kept advancing the whole time, only its OUTPUT was held at zero)
  // can resume at any point in its cycle — up to the full ambient amplitude
  // away from zero. That is bounded by amplitude, not by this bug class:
  // hypot(AMBIENT_AMPLITUDE, AMBIENT_AMPLITUDE*0.7) ≈ 1.95 world units, times
  // up to maxZoom (1.35) ≈ 2.64px worst case. The threshold below (3px) is
  // that bound with headroom, not a re-opened version of the jump above it.
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT }); // ambient/collision default ON
    engine.select(f.focus);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    for (const person of graph.people) {
      if (person.id === f.focus) continue;
      const prevPlan = engine.plan;
      const before = engine.screenPositions();
      engine.select(person.id);
      const newPlan = engine.plan;
      const after = engine.screenPositions();
      for (const [id, pt] of before) {
        const a2 = after.get(id);
        if (!a2) continue;
        // A person whose POD MEMBERSHIP genuinely changes across this
        // reselect (e.g. selecting someone with two direct partners folds a
        // second pod into the active one) is a real recomposition, not a
        // continuity bug — some motion is inherent to that, same as it would
        // be for the active person's own family. Only people whose pod is
        // unchanged are held to the near-zero bar.
        const oldMembers = prevPlan.unitOf.get(id)?.memberIds?.join('|');
        const newMembers = newPlan.unitOf.get(id)?.memberIds?.join('|');
        if (oldMembers !== newMembers) continue;
        // The newly active person's WHOLE pod is deliberately, correctly
        // reset to exactly zero collision displacement the instant it
        // becomes the fixed point (see collision.js and engine.js's own
        // comments) — a partner who previously carried a real, nonzero
        // shared pod displacement legitimately loses it right here. That is
        // a designed consequence of "the whole active pod holds still", not
        // an instance of the coordinate-jump bug this test otherwise guards.
        if (newPlan.unitOf.get(person.id)?.memberIds?.includes(id)) continue;
        const d = Math.hypot(pt.x - a2.x, pt.y - a2.y);
        assert.ok(d < 3,
          `${f.id}: selecting ${person.id} jumped ${id} by ${d.toFixed(2)}px (ambient+collision on)`);
      }
      // Let this transition finish before the next selection — a real click
      // never lands on a family still mid-flight from the last one, and
      // testing that adversarial pile-up isn't what this test is for.
      engine.settle({ dtMs: FRAME, maxFrames: 400 });
    }
  }
});

test('the pin survives zoom changing during the transition', () => {
  // Selecting across a big composition change forces a real zoom change; the
  // active person is the camera's world anchor, so their screen position is
  // invariant under zoom by construction. This proves the construction holds.
  const { engine } = engineFor('deep-lineage');
  const anchor = { x: 300, y: 250 };
  engine.select('d_g1', { anchor });
  const zooms = new Set();
  for (let i = 0; i < 200 && !engine.isSettled(); i++) {
    engine.step(FRAME);
    zooms.add(Number(engine.camera().zoom.toFixed(4)));
    const at = engine.screenPositions().get('d_g1');
    assert.ok(Math.abs(at.x - anchor.x) < 1e-6 && Math.abs(at.y - anchor.y) < 1e-6,
      `moved to ${at.x},${at.y}`);
  }
  assert.ok(zooms.size > 1, 'the zoom really did animate during this transition');
});

/* ── Settling ────────────────────────────────────────────────────────────── */

test('macro motion settles completely, and stays settled', () => {
  for (const f of FIXTURES) {
    const { engine } = engineFor(f.id);
    const target = f.people.find((p) => p.id !== f.focus)?.id ?? f.focus;
    engine.resetMetrics('settle');
    engine.select(target);
    const res = engine.settle({ dtMs: FRAME, maxFrames: 400 });
    assert.ok(res.settled, `${f.id} never settled (${res.frames} frames)`);
    // And it stays settled — no residual jitter waking it back up.
    for (let i = 0; i < 120; i++) {
      const frame = engine.step(FRAME);
      assert.ok(frame.settled, `${f.id} came back out of rest ${i} frames after settling`);
    }
  }
});

test('settling happens within a human-scale budget', () => {
  const { engine } = engineFor('remarried');
  engine.resetMetrics('budget');
  engine.select('r_jason');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const s = engine.summary();
  assert.ok(s.settleMs != null, 'never settled');
  assert.ok(s.settleMs <= 1400, `settle took ${s.settleMs}ms — should read as one deliberate move`);
  assert.ok(s.settleMs >= 150, `settle took ${s.settleMs}ms — that is a snap, not a movement`);
});

test('nothing oscillates: the unsettled count never rises inside a transition', () => {
  for (const f of FIXTURES) {
    const { engine, graph } = engineFor(f.id);
    const other = graph.people.find((p) => p.id !== f.focus);
    if (!other) continue;
    engine.resetMetrics('oscillation');
    engine.select(other.id);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    assert.equal(engine.summary().reboundFrames, 0,
      `${f.id}: ${engine.summary().reboundFrames} frames where more nodes were moving than the frame before`);
  }
});

test('the critically damped step never overshoots its target', () => {
  const omega = omegaForSettleTime(0.6);
  let v = 0;
  let x = -500;
  let crossed = false;
  for (let i = 0; i < 600; i++) {
    [x, v] = stepSpring(x, v, 0, omega, FRAME / 1000);
    if (x > 1e-9) crossed = true;
  }
  assert.ok(!crossed, 'a critically damped spring must approach from one side only');
  assert.ok(Math.abs(x) < 0.05, `did not arrive (residual ${x})`);
});

/* ── Collision stays subordinate to the layout ───────────────────────────── */

test('collision never moves anyone further than its clamp, and never moves the active person', () => {
  for (const f of FIXTURES) {
    const { engine } = engineFor(f.id);
    const target = f.people[f.people.length - 1].id;
    engine.resetMetrics('collision');
    engine.select(target);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    const s = engine.summary();
    assert.ok(s.maxCollisionPush <= MAX_PUSH + 1e-6,
      `${f.id}: collision pushed ${s.maxCollisionPush}, clamp is ${MAX_PUSH}`);
  }
});

test('P2 fix: LocalCollision resolves per POD, not per person', () => {
  // Direct check of the mechanism itself, deliberately isolated from the
  // engine: two people packed on top of each other, sharing a pod, plus a
  // solo neighbour close enough to force a real overlap correction.
  // Resolving per person let the two pod members get pushed by DIFFERENT
  // amounts — visibly stretching or squashing the pod's own fixed spacing —
  // exactly when the composition packed things tight enough to need a real
  // correction, which the live overlay showed reaching the clamp routinely.
  const unitA = { id: 'u:a', memberIds: ['a', 'b'], left: -80, right: 80 };
  const unitOf = new Map([['a', unitA], ['b', unitA]]);
  const positions = new Map([
    ['a', { x: -10, y: 0 }],
    ['b', { x: 10, y: 0 }],
    ['c', { x: 5, y: 0 }], // overlaps the pod's own footprint
  ]);
  const collider = new LocalCollision({ seed: 42 });
  const disp = collider.resolve(positions, null, unitOf);
  assert.deepEqual(disp.get('a'), disp.get('b'), 'pod members a/b must receive the IDENTICAL push');
  assert.ok(Math.hypot(disp.get('a').x, disp.get('a').y) > 0.01, 'expected a real, non-zero pod-level push');
});

test('P2 fix: once settled, every pod member carries the identical collision push + ambient breath, in the real engine', () => {
  // The engine-level counterpart: not mid-transition (where two pod members
  // can legitimately still be at different points along their OWN spring's
  // approach — pure easing lag, not a bug) but at REST, where world position
  // minus planned position reduces to exactly (collision + breath) with no
  // lag confound at all — the state a viewer spends almost all their time
  // looking at.
  for (const f of FIXTURES) {
    const { engine, graph } = engineFor(f.id);
    const target = f.people[f.people.length - 1].id;
    engine.select(target);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    const plan = engine.plan;
    const world = engine.worldPositions();
    const byUnit = new Map();
    for (const person of graph.people) {
      const u = plan.unitOf.get(person.id);
      if (!u || u.memberIds.length < 2) continue;
      if (!byUnit.has(u.id)) byUnit.set(u.id, []);
      byUnit.get(u.id).push(person.id);
    }
    for (const [uid, ids] of byUnit) {
      const deltas = ids.map((id) => {
        const p = plan.positions.get(id), w = world.get(id);
        return { x: w.x - p.x, y: w.y - p.y };
      });
      for (let k = 1; k < deltas.length; k++) {
        const d = Math.hypot(deltas[k].x - deltas[0].x, deltas[k].y - deltas[0].y);
        assert.ok(d < 1e-6, `${f.id}: settled pod ${uid} members ${ids} carry different offsets (${d.toFixed(4)})`);
      }
    }
  }
});

test('collision cannot break the row structure the planner decided', () => {
  const { engine, graph } = engineFor('wide-siblings');
  engine.select('w_s1');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const world = engine.worldPositions();
  const plan = engine.plan;
  for (const person of graph.people) {
    const planned = plan.positions.get(person.id);
    const actual = world.get(person.id);
    const rowDrift = Math.abs(actual.y - planned.y);
    assert.ok(rowDrift < ROW_GAP / 2,
      `${person.id} ended ${rowDrift.toFixed(1)} from its row — collision must not restructure`);
  }
});

test('with collision off the layout is reproduced exactly', () => {
  const { engine } = engineFor('nuclear', { collision: false, ambient: false });
  engine.select('n_b');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const world = engine.worldPositions();
  for (const [id, planned] of engine.plan.positions) {
    const actual = world.get(id);
    assert.ok(Math.hypot(actual.x - planned.x, actual.y - planned.y) < 0.1,
      `${id} rests at (${actual.x},${actual.y}) not (${planned.x},${planned.y})`);
  }
});

/* ── Ambient breathing is bounded, not drift ─────────────────────────────── */

test('breathing is bounded and never accumulates into drift', () => {
  const { engine, graph } = engineFor('nuclear', { collision: false });
  engine.select('n_a');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const planned = engine.plan.positions;
  let worst = 0;
  // Five simulated minutes of breathing.
  for (let i = 0; i < 60 * 60 * 5; i++) {
    engine.step(FRAME);
    if (i % 97 !== 0) continue;
    for (const [id, pt] of engine.worldPositions()) {
      worst = Math.max(worst, Math.hypot(pt.x - planned.get(id).x, pt.y - planned.get(id).y));
    }
  }
  assert.ok(worst < 4, `breathing wandered ${worst.toFixed(2)} from the planned position`);
  assert.ok(engine.isSettled(), 'breathing must not count as unsettled macro motion');
  // And the active person breathes not at all.
  const active = engine.worldPositions().get('n_a');
  assert.ok(Math.hypot(active.x, active.y) < 1e-9, 'the active person must be perfectly still');
});

test('a partner pod breathes coherently — members share a phase', () => {
  const { engine } = engineFor('nuclear', { collision: false });
  engine.select('n_a'); // so the parents' pod is not the pinned active person
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const planned = engine.plan.positions;
  for (let i = 0; i < 240; i++) {
    engine.step(FRAME);
    const w = engine.worldPositions();
    const dadOff = { x: w.get('n_dad').x - planned.get('n_dad').x, y: w.get('n_dad').y - planned.get('n_dad').y };
    const mumOff = { x: w.get('n_mum').x - planned.get('n_mum').x, y: w.get('n_mum').y - planned.get('n_mum').y };
    assert.ok(Math.hypot(dadOff.x - mumOff.x, dadOff.y - mumOff.y) < 1e-9,
      'a couple must breathe as one object, not jostle each other');
  }
});

test('P2 fix: the WHOLE active pod holds still, not just the active person — no stretch/squash', () => {
  // Before this fix, the active person breathed exactly zero while their own
  // partner breathed the unit's full amplitude, subtly stretching and
  // squashing the pod's own rigid spacing every cycle even though the pod is
  // supposed to read as one still, fixed object.
  const { engine } = engineFor('nuclear', { collision: false }); // active = n_dad, partner = n_mum
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const planned = engine.plan.positions;
  for (let i = 0; i < 240; i++) {
    engine.step(FRAME);
    const mum = engine.worldPositions().get('n_mum');
    const plannedMum = planned.get('n_mum');
    assert.ok(Math.hypot(mum.x - plannedMum.x, mum.y - plannedMum.y) < 1e-9,
      "the active person's own partner must be exactly still too, not breathing on their own");
  }
});

/* ── Camera behaviour ────────────────────────────────────────────────────── */

test('the camera has ONE destination per selection and stops there', () => {
  const { engine } = engineFor('distant-pull');
  engine.select('x_kid1');
  const destination = engine.plan.camera.zoom;
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  assert.ok(Math.abs(engine.camera().zoom - destination) < 0.01,
    `camera rested at ${engine.camera().zoom}, destination was ${destination}`);
  // Crucially it is not recomputed from live bounds: another 200 frames of
  // breathing must not move it at all.
  const resting = { ...engine.camera() };
  for (let i = 0; i < 200; i++) engine.step(FRAME);
  assert.deepEqual(engine.camera(), resting, 'the camera re-framed itself while nothing was happening');
});

test('an explicit anchor is honoured exactly, even an awkward one — no quiet correction', () => {
  const { engine } = engineFor('nuclear');
  engine.select('n_c', { anchor: { x: 40, y: 60 } });
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const at = engine.screenPositions().get('n_c');
  assert.ok(Math.abs(at.x - 40) < 1e-6 && Math.abs(at.y - 60) < 1e-6,
    `landed at ${at.x},${at.y} — the engine second-guessed the caller`);
});

test('recenter() is the ONLY thing that moves the selected person, and only when asked', () => {
  const { engine } = engineFor('nuclear');
  engine.select('n_c', { anchor: { x: 40, y: 60 } });
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const before = engine.screenPositions().get('n_c');

  engine.recenter();
  assert.ok(!engine.isSettled(), 'recenter should start a fresh, deliberate movement');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const after = engine.screenPositions().get('n_c');

  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 50,
    'recenter is supposed to move the composition');
  // And the composition now sits centred.
  const xs = [...engine.screenPositions().values()].map((p) => p.x);
  const ys = [...engine.screenPositions().values()].map((p) => p.y);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - VIEWPORT.width / 2) < 60);
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - VIEWPORT.height / 2) < 60);
});

/* ── Reduced motion ──────────────────────────────────────────────────────── */

test('reduced motion arrives immediately, with no breathing at all', () => {
  const { engine } = engineFor('remarried', { reducedMotion: true });
  engine.select('r_ken');
  assert.ok(engine.isSettled(), 'reduced motion must not animate');
  const world = engine.worldPositions();
  for (const [id, planned] of engine.plan.positions) {
    const actual = world.get(id);
    assert.ok(Math.hypot(actual.x - planned.x, actual.y - planned.y) < 1e-9, `${id} is not at rest`);
  }
  for (let i = 0; i < 300; i++) engine.step(FRAME);
  const later = engine.worldPositions();
  for (const [id, pt] of world) {
    assert.ok(Math.hypot(later.get(id).x - pt.x, later.get(id).y - pt.y) < 1e-9, `${id} moved`);
  }
});

/* ── The comparison the experiment exists to make ────────────────────────── */

test('V1 keeps moving and drags the selected person; V2 settles and holds them', () => {
  const f = fixtureById('remarried');
  const graph = buildGraph(f.people, f.relationships);

  const v1 = createLegacyEngine({ graph, viewport: VIEWPORT });
  v1.select(f.focus);
  v1.settle({ dtMs: FRAME, maxFrames: 200 });
  v1.resetMetrics('v1');
  v1.select('r_jason');
  for (let i = 0; i < 240; i++) v1.step(FRAME);
  const v1s = v1.summary();

  const v2 = createMotionEngine({ graph, viewport: VIEWPORT });
  v2.select(f.focus);
  v2.settle({ dtMs: FRAME, maxFrames: 200 });
  v2.resetMetrics('v2');
  const anchor = v2.screenPositions().get('r_jason');
  v2.select('r_jason', { anchor });
  for (let i = 0; i < 240; i++) v2.step(FRAME);
  const v2s = v2.summary();

  assert.ok(v1s.maxActiveDriftPx > 1,
    `V1 should visibly drag the selected person (measured ${v1s.maxActiveDriftPx}px/frame)`);
  assert.equal(v2s.maxActiveDriftPx, 0, 'V2 must hold them exactly still');
  assert.ok(v2s.settled, 'V2 must reach rest');
  assert.ok(!v1s.settled, 'V1 is expected never to reach rest — that is the behaviour under review');
  console.log(`      V1 drift ${v1s.maxActiveDriftPx}px/frame, settled=${v1s.settled}`);
  console.log(`      V2 drift ${v2s.maxActiveDriftPx}px/frame, settled=${v2s.settled} in ${v2s.settleMs}ms`);
});

/* ── Determinism of the whole pipeline, not just the planner ─────────────── */

test('two identical runs of the full engine produce identical frames', () => {
  const run = () => {
    const f = fixtureById('three-pod');
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT });
    engine.select(f.focus);
    engine.resetMetrics('determinism');
    engine.select('t_k2', { anchor: { x: 500, y: 400 } });
    const trace = [];
    for (let i = 0; i < 90; i++) {
      engine.step(FRAME);
      trace.push([...engine.worldPositions().entries()]
        .sort()
        .map(([id, p]) => `${id}:${p.x.toFixed(6)},${p.y.toFixed(6)}`)
        .join('|'));
    }
    return trace.join('\n');
  };
  assert.equal(run(), run(), 'the engine is not reproducible run to run');
});

test('every fixture survives selecting every person without producing a non-finite position', () => {
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT });
    engine.select(f.focus);
    for (const person of graph.people) {
      engine.select(person.id);
      engine.settle({ dtMs: FRAME, maxFrames: 200 });
      for (const [id, pt] of engine.screenPositions()) {
        assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y),
          `${f.id}/${person.id}: ${id} became non-finite`);
      }
    }
  }
});

/* ── P2 fix: instrumentation itself is what a reviewer/CI actually judges ── */

test('P2 fix: verdict() passes a clean transition and reports named failures for a bad one', () => {
  // The whole point of named thresholds is that pass/fail is a computed
  // fact, not eyeballed off raw numbers — verify both directions of that.
  const { engine } = engineFor('remarried');
  engine.select('r_jason');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const clean = engine.summary();
  assert.equal(clean.passed, true, `expected a clean transition to pass: ${clean.failures.join('; ')}`);
  assert.deepEqual(clean.failures, []);

  const bad = verdict({
    maxActiveDriftPx: 0, selectionBoundaryJumpPx: 47, maxNodeDisplacementPx: 0,
    maxCollisionPush: 0, directionReversals: 0, reboundFrames: 0,
  });
  assert.equal(bad.passed, false);
  assert.ok(bad.failures.some((f) => f.startsWith('selectionBoundaryJumpPx')),
    `expected a named selectionBoundaryJumpPx failure, got: ${bad.failures.join('; ')}`);
});

test('P2 fix: the OFFICIAL selectionBoundaryJumpPx metric — not just an external test script — catches the P1 jump class', () => {
  // The earlier P1 tests prove the bug is fixed by comparing screen
  // positions from OUTSIDE the engine. This proves the engine's OWN
  // instrumentation — the thing a reviewer actually watches in the dev
  // overlay, and the thing CI actually asserts on — reports the same clean
  // result, for every fixture and every selection.
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    const engine = createMotionEngine({ graph, viewport: VIEWPORT });
    engine.select(f.focus);
    engine.settle({ dtMs: FRAME, maxFrames: 400 });
    for (const person of graph.people) {
      if (person.id === f.focus) continue;
      engine.resetMetrics(`select:${person.id}`);
      engine.select(person.id);
      engine.step(FRAME); // summary() needs at least one recorded frame
      const s = engine.summary();
      assert.ok(s.selectionBoundaryJumpPx <= PASS_FAIL_THRESHOLDS.selectionBoundaryJumpPx,
        `${f.id}: selecting ${person.id} reported selectionBoundaryJumpPx=${s.selectionBoundaryJumpPx}`);
      engine.settle({ dtMs: FRAME, maxFrames: 400 });
    }
  }
});

test('P2 fix: every real, undisturbed transition in every fixture passes verdict() — the threshold is a usable bar, not a spot check', () => {
  // The individual metric tests above each pick one illustrative
  // fixture/person. This is the exhaustive version: every person, in every
  // fixture, selected from a settled rest state, run to its own natural
  // settle — the same shape of sweep the dev overlay's verdict badge is
  // watched against live. A threshold nobody can actually clear on ordinary
  // fixtures is not a bar, so this is what PASS_FAIL_THRESHOLDS is tuned
  // against (see maxNodeDisplacementPx's own comment in metrics.js for the
  // spring-velocity math behind its value).
  let checked = 0;
  for (const f of FIXTURES) {
    const graph = buildGraph(f.people, f.relationships);
    for (const person of graph.people) {
      const engine = createMotionEngine({ graph, viewport: VIEWPORT });
      engine.select(f.focus);
      engine.settle({ dtMs: FRAME, maxFrames: 400 });
      engine.resetMetrics(`select:${person.id}`);
      engine.select(person.id);
      engine.settle({ dtMs: FRAME, maxFrames: 400 });
      checked++;
      const s = engine.summary();
      assert.equal(s.passed, true,
        `${f.id}/${person.id}: ${s.failures.join('; ')} (maxNodeDisplacementPx=${s.maxNodeDisplacementPx})`);
    }
  }
  assert.ok(checked >= 70, `expected a substantial sweep, only checked ${checked}`);
});

test('P2 fix: direction reversals stay at zero for a real, undisturbed spring transition', () => {
  // A critically damped spring provably never overshoots (see the isolated
  // stepSpring test above) — this is the INTEGRATED version of that same
  // claim, watching every node in a real multi-person transition rather
  // than one spring in isolation.
  const { engine } = engineFor('wide-siblings', { collision: false });
  engine.select('w_s8');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const s = engine.summary();
  assert.equal(s.directionReversals, 0, `unexpected reversals: ${s.directionReversals}`);
});

test('P2 fix: acceleration and collision-push-delta are recorded and stay finite', () => {
  const { engine } = engineFor('three-pod');
  engine.select('t_k3');
  engine.settle({ dtMs: FRAME, maxFrames: 400 });
  const s = engine.summary();
  assert.ok(Number.isFinite(s.maxAcceleration) && s.maxAcceleration >= 0);
  assert.ok(Number.isFinite(s.maxCollisionPushDelta) && s.maxCollisionPushDelta >= 0);
  assert.ok(Number.isFinite(s.maxZoomVelocity) && s.maxZoomVelocity >= 0);
  assert.ok(Number.isFinite(s.maxNodeDisplacementPx) && s.maxNodeDisplacementPx >= 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
