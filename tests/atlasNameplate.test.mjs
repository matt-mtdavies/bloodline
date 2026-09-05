/**
 * The lens's own name pill — the collision pass specifically (packRow/
 * layoutLabels). buildNamePill itself needs a renderer and is exercised
 * live via Playwright instead; these two are pure, so the packing itself is
 * asserted directly against the actual failure this was built to fix: a
 * tight row of full names — "Christopher Monish-Davies" among them —
 * printing on top of each other.
 *
 * Run with: node tests/atlasNameplate.test.mjs
 */
import assert from 'node:assert/strict';
import { packRow, layoutLabels } from '../src/viz/atlas/nameplateLayout.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('a single label is never moved', () => {
  const out = packRow([{ id: 'A', x: 37, halfWidth: 40 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].x, 37);
});

test('two labels with room between them stay exactly where they wanted to be', () => {
  const out = packRow([{ id: 'A', x: -100, halfWidth: 20 }, { id: 'B', x: 100, halfWidth: 20 }]);
  const a = out.find((o) => o.id === 'A'), b = out.find((o) => o.id === 'B');
  assert.equal(a.x, -100);
  assert.equal(b.x, 100);
});

test('two overlapping labels are pushed apart, symmetrically, until they just clear', () => {
  // Both centred on 0 with a wide half-width: a direct stand-in for two
  // portraits sitting close enough that their full-name pills collide.
  const out = packRow([{ id: 'A', x: -10, halfWidth: 60 }, { id: 'B', x: 10, halfWidth: 60 }]);
  const a = out.find((o) => o.id === 'A'), b = out.find((o) => o.id === 'B');
  assert.ok(a.x < b.x, 'left stays left, right stays right — order is never flipped');
  const edgeGap = (b.x - 60) - (a.x + 60);
  assert.ok(Math.abs(edgeGap - 4) < 1e-6, `pills should just clear with the row margin (got edge gap ${edgeGap})`);
  // Symmetric input: the fix should not silently favour one side.
  assert.ok(Math.abs((a.x - -10) - (10 - b.x)) < 1e-6, 'a symmetric collision should be resolved symmetrically');
});

test('the exact reported shape: a real long name crowds its neighbours apart, never past them', () => {
  // "Christopher Monish-Davies" among two shorter names, all at the wide
  // MATE-scale spacing portrait.js actually uses for a parent/step-parent
  // row — this is the real screenshot, in numbers.
  const items = [
    { id: 'HEATHER', x: -72, halfWidth: 55 },
    { id: 'CHRISTOPHER', x: 72, halfWidth: 95 }, // the long one
    { id: 'KEN', x: 216, halfWidth: 48 },
  ];
  const out = packRow(items);
  const byId = Object.fromEntries(out.map((o) => [o.id, o.x]));
  assert.ok(byId.HEATHER < byId.CHRISTOPHER, 'left-to-right order preserved');
  assert.ok(byId.CHRISTOPHER < byId.KEN, 'left-to-right order preserved');
  const gapHC = (byId.CHRISTOPHER - 95) - (byId.HEATHER + 55);
  const gapCK = (byId.KEN - 48) - (byId.CHRISTOPHER + 95);
  assert.ok(gapHC > -1e-6, `Heather and Christopher's pills must not overlap (edge gap ${gapHC})`);
  assert.ok(gapCK > -1e-6, `Christopher and Ken's pills must not overlap (edge gap ${gapCK})`);
});

test('rows are independent: a wrapped row well below never collides with the row above it', () => {
  const items = [
    { id: 'A', x: 0, y: 0, halfWidth: 60 },
    { id: 'B', x: 10, y: 0, halfWidth: 60 }, // overlaps A within the same row
    { id: 'C', x: 5, y: 300, halfWidth: 60 }, // a different generation entirely, x happens to be close
  ];
  const out = layoutLabels(items);
  assert.notEqual(out.get('A').x, out.get('B').x, 'the same-row pair still gets separated');
  assert.equal(out.get('C').x, 5, 'a person on a completely different row is untouched by a collision two rows away');
  assert.equal(out.get('C').y, 300, 'y always passes through unchanged — this pass only ever moves labels sideways');
});

test('a wrapped sub-row (a few world-units of ROW_STACK below the first) is treated as its own row, not folded into it', () => {
  // portrait.js's ROW_STACK is ~130 world units — comfortably more than the
  // rounding bucket (20) this groups by, so two real rows never merge.
  const items = [
    { id: 'A', x: 0, y: 0, halfWidth: 60 },
    { id: 'B', x: 0, y: 130, halfWidth: 60 }, // directly below A, a wrapped row, not a collision
  ];
  const out = layoutLabels(items);
  assert.equal(out.get('A').x, 0);
  assert.equal(out.get('B').x, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
