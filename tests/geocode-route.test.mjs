/**
 * Unit tests for functions/api/geocode.js — the thin route file over
 * functions/_lib/geocode.js (the actual logic, covered by
 * tests/geocode.test.mjs). Only the auth/validation glue is tested here.
 * Run with: node tests/geocode-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/geocode.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

await atest('POST /api/geocode: 401 when not logged in', async () => {
  const res = await onRequestPost({ request: req({ places: ['Cardiff'] }), env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('POST /api/geocode: 503 when DB is not configured, even for a logged-in user', async () => {
  const res = await onRequestPost({ request: req({ places: ['Cardiff'] }), env: {}, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
});

await atest('POST /api/geocode: 400 on malformed JSON', async () => {
  const res = await onRequestPost({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: {} }, data: { user: { uid: 'u1' } },
  });
  assert.equal(res.status, 400);
});

await atest('POST /api/geocode: an empty/missing places list returns {} without touching the DB', async () => {
  const res = await onRequestPost({ request: req({}), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { places: {} });
});

await atest('POST /api/geocode: non-string entries in places are silently filtered, not a crash', async () => {
  const res = await onRequestPost({ request: req({ places: [123, null, ''] }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { places: {} });
});

await atest('POST /api/geocode: 400 when the batch exceeds the per-request cap', async () => {
  const places = Array.from({ length: 51 }, (_, i) => `Place ${i}`);
  const res = await onRequestPost({ request: req({ places }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 400);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
