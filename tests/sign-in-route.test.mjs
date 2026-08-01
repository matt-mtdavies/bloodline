/**
 * Regression test for the same bug tests/index-route.test.mjs covers from
 * the other side: functions/sign-in.js's inline script must always redirect
 * to a URL functions/index.js's FLOW_PARAMS allowlist recognizes, even when
 * no ?start= was present on /sign-in (the plain nav-menu "Sign in" link, not
 * one of the /start start-path buttons) — otherwise the visitor lands back
 * on the marketing homepage with a code already sent and no way to enter it.
 * Run with: node tests/sign-in-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/sign-in.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

await atest('bare /sign-in (no ?start=) still redirects to a URL carrying the otp flow marker', async () => {
  const res = await onRequestGet({ request: new Request('https://example.com/sign-in'), env: {} });
  const html = await res.text();
  assert.match(html, /window\.location\.href\s*=\s*dest/);
  assert.match(html, /var dest = '\/\?otp=1'/);
});

await atest('/sign-in?start=fresh still carries both the otp marker and the start value', async () => {
  const res = await onRequestGet({ request: new Request('https://example.com/sign-in?start=fresh'), env: {} });
  const html = await res.text();
  assert.match(html, /var dest = '\/\?otp=1'/);
  assert.match(html, /dest \+= '&start=' \+ encodeURIComponent\(START\)/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
