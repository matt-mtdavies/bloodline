/**
 * Unit tests for src/viz/links.js's pure geometry helpers — reapplied from
 * PR #127 ("Lay the organic tree out by family structure"), which was
 * reverted (#129) because its FORCE-layout changes weren't behaving on the
 * real tree, but whose visual-only pieces (the couple-line anchor point and
 * the parent→child taper) are independent of that and safe to bring back on
 * their own. capsuleBottom is the one piece with enough pure geometry to
 * usefully unit test; the tapered-ribbon rendering is exercised visually
 * (Playwright, not here) since it draws directly into a Pixi Graphics.
 * Run with: node tests/links.test.mjs
 */
import assert from 'node:assert/strict';
import { capsuleBottom } from '../src/viz/links.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a horizontal couple: the anchor sits directly below the midpoint, hw below', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  const p = capsuleBottom(a, b, 30);
  assert.ok(close(p.x, 50), `x should be the midpoint (50), got ${p.x}`);
  assert.ok(close(p.y, 30), `y should be hw (30) below the midpoint, got ${p.y}`);
});

test('a vertical couple: the anchor exits around the lower end cap, not through a side', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 100 };
  const p = capsuleBottom(a, b, 30);
  // len/2 + hw = 50 + 30 = 80 below the midpoint (y=50) -> y=130.
  assert.ok(close(p.x, 0), `x should stay on the centre line, got ${p.x}`);
  assert.ok(close(p.y, 130), `y should be len/2+hw below the midpoint, got ${p.y}`);
});

test('a steep diagonal couple still exits through the lower end cap (capExit wins)', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 100 }; // nearly vertical
  const p = capsuleBottom(a, b, 30);
  const len = Math.hypot(10, 100);
  const capExit = len / 2 + 30;
  const alongX = Math.abs(10 / len);
  const sideExit = 30 / alongX;
  assert.ok(capExit < sideExit, 'sanity: this case should be cap-limited');
  assert.ok(close(p.y, 50 + capExit), `should exit via the end cap, got y=${p.y}`);
});

test('a shallow diagonal couple exits through the long side (sideExit wins)', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 10 }; // nearly horizontal
  const p = capsuleBottom(a, b, 30);
  const len = Math.hypot(100, 10);
  const capExit = len / 2 + 30;
  const alongX = Math.abs(100 / len);
  const sideExit = 30 / alongX;
  assert.ok(sideExit < capExit, 'sanity: this case should be side-limited');
  assert.ok(close(p.y, 5 + sideExit), `should exit via the long side, got y=${p.y}`);
});

test('the anchor never lands strictly inside the capsule (distance from the segment is always >= hw)', () => {
  // A handful of angles, always checking the returned point is on or outside
  // the capsule boundary — never inside the shaded fill.
  const hw = 24;
  const cases = [
    [{ x: 0, y: 0 }, { x: 60, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 60 }],
    [{ x: 0, y: 0 }, { x: 40, y: 40 }],
    [{ x: -20, y: 10 }, { x: 30, y: -15 }],
  ];
  for (const [a, b] of cases) {
    const p = capsuleBottom(a, b, hw);
    // Distance from p to the segment a-b.
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx, projY = a.y + t * dy;
    const dist = Math.hypot(p.x - projX, p.y - projY);
    assert.ok(dist >= hw - 1e-6, `anchor at distance ${dist} should be >= hw (${hw}) for a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
