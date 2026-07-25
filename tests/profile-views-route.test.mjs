/**
 * Unit tests for functions/api/profile-views.js — the thin route file over
 * functions/_lib/profileViews.js (the actual logic, covered by
 * tests/profileViews.test.mjs). Only the auth/validation glue is tested
 * here, same convention as tests/geocode-route.test.mjs.
 * Run with: node tests/profile-views-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost, onRequestGet } from '../functions/api/profile-views.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

await atest('POST /api/profile-views: 401 when not logged in', async () => {
  const res = await onRequestPost({ request: req({ personId: 'p1' }), env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('GET /api/profile-views: 401 when not logged in', async () => {
  const res = await onRequestGet({ env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('POST /api/profile-views: 503 when DB is not configured', async () => {
  const res = await onRequestPost({ request: req({ personId: 'p1' }), env: {}, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
});

await atest('POST /api/profile-views: 400 on malformed JSON', async () => {
  const res = await onRequestPost({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: {} }, data: { user: { uid: 'u1' } },
  });
  assert.equal(res.status, 400);
});

await atest('POST /api/profile-views: 400 when personId is missing or not a string', async () => {
  const res1 = await onRequestPost({ request: req({}), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res1.status, 400);
  const res2 = await onRequestPost({ request: req({ personId: 123 }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res2.status, 400);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
