/**
 * Canopy motion — springs, breathing, and the elastic pull.
 *
 * The pull exists to answer a real question: "should we be able to move the
 * bubbles after landing?" The answer shipped here is that a person can be
 * MOVED without being REPOSITIONED — pulled against rising resistance, with
 * their relatives swaying after them, and released back to exactly where the
 * plan says they belong. These tests are what make "exactly" true rather
 * than approximately true, because a pull that leaves anyone even slightly
 * off their planned spot is a manual position by another name, and manual
 * positions are the thing this whole view exists to be rid of.
 *
 * Run with: node tests/canopyMotion.test.mjs
 */
import assert from 'node:assert/strict';
import {
  Scalar, step1D, omegaFor, ambientOffset, rubberBand, Deflection,
  PULL_MAX, AMBIENT_AMP, AMBIENT_PERIOD_S,
  composeCamera, MIN_READABLE_ZOOM, MAX_ZOOM,
} from '../src/viz/canopy/motion.js';

/* A minimal composeCamera fixture: nodes spread across `rows`, each row a
 * list of x positions at y = row * rowGap. Mirrors just enough of a real
 * frame's shape (nodes Map + units array) for composeCamera's own math,
 * without needing a real planCanopy call. */
function fakeFrame(rowsOfX, rowGap = 310) {
  const nodes = new Map();
  const units = [];
  let i = 0;
  for (const [row, xs] of rowsOfX) {
    for (const x of xs) {
      const id = `p${i++}`;
      nodes.set(id, { x, y: row * rowGap, r: 54, labelHalfWidth: 40, band: 'kin' });
      units.push({ row, x, anchorOnly: false });
    }
  }
  return { nodes, units };
}

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

/* ── springs ──────────────────────────────────────────────────────────── */

test('a critically damped spring never overshoots its target', () => {
  const s = new Scalar(0, 0.5);
  s.to(100);
  let prev = -Infinity;
  for (let i = 0; i < 400; i++) {
    s.step(1 / 60);
    assert.ok(s.value <= 100.0001, `overshot to ${s.value}`);
    assert.ok(s.value >= prev - 0.0001, 'never reverses direction');
    prev = s.value;
  }
});

test('macro motion provably settles — this is the whole premise', () => {
  const s = new Scalar(0, 0.5);
  s.to(250);
  for (let i = 0; i < 300; i++) s.step(1 / 60);
  assert.ok(s.settled, `still moving: value ${s.value}, velocity ${s.velocity}`);
  assert.ok(Math.abs(s.value - 250) < 0.5);
});

test('the closed-form step is frame-rate independent', () => {
  // One 100ms step must land where six ~16.7ms steps do. An explicit
  // integrator would drift here, and a dropped frame would overshoot.
  const omega = omegaFor(0.5);
  let [aV, aVel] = [0, 0];
  [aV, aVel] = step1D(aV, aVel, 100, omega, 0.1);
  let [bV, bVel] = [0, 0];
  for (let i = 0; i < 6; i++) [bV, bVel] = step1D(bV, bVel, 100, omega, 0.1 / 6);
  assert.ok(Math.abs(aV - bV) < 1.5, `big step ${aV} vs small steps ${bV}`);
});

/* ── breathing ────────────────────────────────────────────────────────── */

test('breathing is bounded — it can never wander into drift', () => {
  const cap = AMBIENT_AMP * 1.6; // both harmonics at once, worst case
  for (let t = 0; t < 600; t += 0.37) {
    const o = ambientOffset('u:someone', t);
    assert.ok(Math.abs(o.x) <= cap, `x drifted to ${o.x} at t=${t}`);
    assert.ok(Math.abs(o.y) <= cap, `y drifted to ${o.y} at t=${t}`);
    assert.ok(o.scale > 0.9 && o.scale < 1.1, 'scale breath stays subtle');
  }
});

test('breathing is stateless — the same time always gives the same offset', () => {
  const a = ambientOffset('u:x', 12.5);
  for (let t = 0; t < 40; t += 1.3) ambientOffset('u:x', t); // churn
  const b = ambientOffset('u:x', 12.5);
  assert.deepEqual(a, b);
});

test('breathing is perceptible — the bug was that it was not', () => {
  /* It was 1.5 units over 7.5s: about a pixel, taking four seconds to get
   * there. Mathematically present, visually absent, and the view read as
   * dead paper. Guard the floor so nobody quietly tunes it back to nothing. */
  assert.ok(AMBIENT_AMP >= 3.5, `amplitude ${AMBIENT_AMP} is too small to see`);
  let peak = 0;
  for (let t = 0; t < AMBIENT_PERIOD_S * 2; t += 0.05) {
    peak = Math.max(peak, Math.abs(ambientOffset('u:x', t).x));
  }
  assert.ok(peak > 2.5, `peak travel of ${peak.toFixed(2)} units is imperceptible`);
});

test('two families do not breathe in lockstep', () => {
  // A single frequency across everybody reads as one mechanism, not as life.
  let maxAgree = 0;
  for (let t = 0; t < 30; t += 0.25) {
    const a = ambientOffset('u:alpha', t), b = ambientOffset('u:bravo', t);
    maxAgree = Math.max(maxAgree, 1 - Math.abs(a.x - b.x) / (AMBIENT_AMP * 2));
  }
  const differed = [];
  for (let t = 0; t < 30; t += 0.25) {
    const a = ambientOffset('u:alpha', t), b = ambientOffset('u:bravo', t);
    differed.push(Math.abs(a.x - b.x));
  }
  const avg = differed.reduce((s, x) => s + x, 0) / differed.length;
  assert.ok(avg > 0.5, `two units move almost identically (avg delta ${avg.toFixed(3)})`);
});

/* ── the elastic pull ─────────────────────────────────────────────────── */

test('a small pull follows the pointer almost exactly', () => {
  const p = rubberBand(10, 0);
  assert.ok(p.x > 8.5 && p.x <= 10, `expected near-1:1 at small pull, got ${p.x}`);
});

test('resistance rises and displacement can never exceed the cap', () => {
  let prev = 0;
  for (const d of [20, 60, 150, 400, 5000]) {
    const p = rubberBand(d, 0);
    assert.ok(p.x < PULL_MAX, `pull of ${d} reached ${p.x}, at or past the cap`);
    assert.ok(p.x > prev, 'further pulls still move, just less');
    assert.ok(p.x < d, 'resistance is always doing something');
    prev = p.x;
  }
});

test('the pull keeps its direction', () => {
  const p = rubberBand(-300, 400);
  assert.ok(p.x < 0 && p.y > 0, 'signs preserved');
  const ratioIn = -300 / 400, ratioOut = p.x / p.y;
  assert.ok(Math.abs(ratioIn - ratioOut) < 0.001, 'angle preserved');
});

test('a zero pull is exactly zero — no jitter at rest', () => {
  assert.deepEqual(rubberBand(0, 0), { x: 0, y: 0 });
});

test('released, a person returns EXACTLY home — not nearly home', () => {
  const d = new Deflection();
  d.hold(70, -40);
  assert.deepEqual(d.value, { x: 70, y: -40 }, 'held under the finger, no spring');
  d.release();
  for (let i = 0; i < 240; i++) d.step(1 / 60);
  assert.ok(Math.abs(d.value.x) < 0.01, `left ${d.value.x} off home in x`);
  assert.ok(Math.abs(d.value.y) < 0.01, `left ${d.value.y} off home in y`);
  assert.ok(d.resting, 'reports itself resting so the view can drop it');
});

test('a lean settles toward its share of the pull, then home again', () => {
  const d = new Deflection();
  d.lean(30, 0);
  for (let i = 0; i < 120; i++) d.step(1 / 60);
  assert.ok(Math.abs(d.value.x - 30) < 0.5, `leaned to ${d.value.x}, expected ~30`);
  assert.ok(!d.resting, 'a held lean is not resting');
  d.release();
  for (let i = 0; i < 240; i++) d.step(1 / 60);
  assert.ok(d.resting && Math.abs(d.value.x) < 0.01);
});

test('a deflection at rest is reported so idle frames cost nothing', () => {
  const d = new Deflection();
  assert.ok(d.resting, 'a fresh deflection is already at rest');
});

/* ── composeCamera's readable-zoom floor ─────────────────────────────────
 * Real report, with a screenshot, against a 1,200-person tree: a wide row of
 * satellites forced the width-fit zoom down, the legibility floor caught it
 * and set zoom to exactly MIN_READABLE_ZOOM — discarding what the frame's
 * actual HEIGHT could have supported, even though the content was only three
 * rows tall. The composition read as a thin band of content marooned in a
 * sea of empty paper. */

test('a wide-but-short frame climbs past the bare floor to use the height it actually has', () => {
  // Two rows only (short vertically), but row -1 spans 3000px (wide) — the
  // "wide satellite row, few rows tall" shape from the report, on a tall
  // enough viewport that height genuinely has room to spare.
  const frame = fakeFrame([
    [-1, [-1500, -750, 0, 750, 1500]],
    [0, [0]],
  ], 310);
  const { zoom } = composeCamera(frame, { width: 390, height: 1400, topInset: 96, bottomInset: 104 });
  assert.ok(zoom > MIN_READABLE_ZOOM + 0.01,
    `expected zoom to climb above the bare floor (${MIN_READABLE_ZOOM}), got ${zoom}`);
});

test('a frame that is ALSO tight vertically still floors at MIN_READABLE_ZOOM, never below', () => {
  // Both wide AND tall — six generations, each row also wide. Neither axis
  // can support more than the floor, so the floor itself must still hold.
  const rows = [];
  for (let r = -3; r <= 3; r++) rows.push([r, [-1200, -600, 0, 600, 1200]]);
  const frame = fakeFrame(rows, 310);
  const { zoom } = composeCamera(frame, { width: 390, height: 700, topInset: 96, bottomInset: 104 });
  assert.ok(Math.abs(zoom - MIN_READABLE_ZOOM) < 1e-9 || zoom > MIN_READABLE_ZOOM,
    `zoom should never fall below the readable floor, got ${zoom}`);
  assert.ok(zoom <= MAX_ZOOM + 1e-9);
});

test('a frame that already fits comfortably is unaffected by the floor at all', () => {
  const frame = fakeFrame([
    [-1, [-150, 150]],
    [0, [0]],
    [1, [-100, 100]],
  ], 310);
  const { zoom } = composeCamera(frame, { width: 1280, height: 900, topInset: 96, bottomInset: 104 });
  assert.ok(zoom <= MAX_ZOOM + 1e-9 && zoom >= MIN_READABLE_ZOOM,
    `a small, comfortably-fitting frame should never need the floor, got ${zoom}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
