/**
 * Regression test for a real reported bug: a signed-out visitor clicking the
 * plain "Sign in" nav link (no ?start=) would request a code, get redirected
 * to a bare "/", and land back on the public marketing homepage with no
 * visible way to enter the code — functions/index.js only lets "/" fall
 * through to the SPA (where LoginScreen reads the pending email out of
 * sessionStorage) when the URL carries a recognized flow param or the
 * visitor is already authenticated. functions/sign-in.js now always appends
 * ?otp=1 to the post-request redirect; this confirms functions/index.js
 * treats that as a flow param and falls through to the SPA rather than
 * re-rendering the marketing page.
 * Run with: node tests/index-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/index.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function fakeAssets(marker) {
  return { fetch: async () => new Response(marker, { status: 200, headers: { 'content-type': 'text/html' } }) };
}

await atest('bare "/" with no flow param and not authed renders the marketing homepage', async () => {
  const res = await onRequestGet({
    request: new Request('https://example.com/'),
    env: { ASSETS: fakeAssets('SPA') },
    data: {},
  });
  const body = await res.text();
  assert.notEqual(body, 'SPA');
  assert.match(body, /Bloodline/);
});

await atest('"/?otp=1" (the post-sign-in redirect) falls through to the SPA', async () => {
  const res = await onRequestGet({
    request: new Request('https://example.com/?otp=1'),
    env: { ASSETS: fakeAssets('SPA') },
    data: {},
  });
  const body = await res.text();
  assert.equal(body, 'SPA');
});

await atest('"/?otp=1" response is still marked noindex, like every other flow-param fallthrough', async () => {
  const res = await onRequestGet({
    request: new Request('https://example.com/?otp=1'),
    env: { ASSETS: fakeAssets('SPA') },
    data: {},
  });
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

await atest('an authenticated request always falls through, even with no flow param', async () => {
  const res = await onRequestGet({
    request: new Request('https://example.com/'),
    env: { ASSETS: fakeAssets('SPA') },
    data: { user: { uid: 'u1' } },
  });
  const body = await res.text();
  assert.equal(body, 'SPA');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
