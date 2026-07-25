/**
 * Unit tests for functions/api/moment-engagement.js — the thin route file
 * over functions/_lib/momentEngagement.js (the actual logic, covered by
 * tests/momentEngagement.test.mjs). Only the auth/validation glue is
 * tested here, same convention as tests/profile-views-route.test.mjs.
 * Run with: node tests/moment-engagement-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/moment-engagement.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

await atest('401 when not logged in', async () => {
  const res = await onRequestPost({ request: req({ momentKey: 'birthdayToday', event: 'shown' }), env: { DB: {} }, data: {} });
  assert.equal(res.status, 401);
});

await atest('503 when DB is not configured', async () => {
  const res = await onRequestPost({ request: req({ momentKey: 'birthdayToday', event: 'shown' }), env: {}, data: { user: { uid: 'u1' } } });
  assert.equal(res.status, 503);
});

await atest('400 on malformed JSON', async () => {
  const res = await onRequestPost({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: {} }, data: { user: { uid: 'u1' } },
  });
  assert.equal(res.status, 400);
});

await atest('400 when momentKey is missing or not a string', async () => {
  const res1 = await onRequestPost({ request: req({ event: 'shown' }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res1.status, 400);
  const res2 = await onRequestPost({ request: req({ momentKey: 123, event: 'shown' }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res2.status, 400);
});

await atest('400 when event is missing or not one of shown/tapped', async () => {
  const res1 = await onRequestPost({ request: req({ momentKey: 'birthdayToday' }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res1.status, 400);
  const res2 = await onRequestPost({ request: req({ momentKey: 'birthdayToday', event: 'clicked' }), env: { DB: {} }, data: { user: { uid: 'u1' } } });
  assert.equal(res2.status, 400);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
