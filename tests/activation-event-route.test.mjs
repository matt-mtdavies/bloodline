/**
 * Unit tests for functions/api/activation-event.js — the write-only sink for
 * the aggregate activation-funnel telemetry (docs/PRODUCTIZATION-BRIEF.md
 * §11.7 / §12 Phase B). No auth required (fires from signed-out public
 * pages too), so these tests focus on: it never depends on a working DB,
 * `event` is checked against a fixed allowlist, and `path` is silently
 * dropped unless it's one of the three known start-path values.
 * Run with: node tests/activation-event-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/activation-event.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(body) {
  return { json: async () => body };
}

function mockDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { run: async () => ({ success: true }) };
        },
      };
    },
  };
}

await atest('200 ok:true even with no DB configured at all (never a hard dependency)', async () => {
  const res = await onRequestPost({ request: req({ event: 'cta_click' }), env: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

await atest('400 on malformed JSON', async () => {
  const res = await onRequestPost({
    request: { json: async () => { throw new SyntaxError('bad json'); } },
    env: { DB: mockDb() },
  });
  assert.equal(res.status, 400);
});

await atest('400 when event is missing or not a known event', async () => {
  const res1 = await onRequestPost({ request: req({}), env: { DB: mockDb() } });
  assert.equal(res1.status, 400);
  const res2 = await onRequestPost({ request: req({ event: 'literally_anything' }), env: { DB: mockDb() } });
  assert.equal(res2.status, 400);
});

await atest('accepts every event in the documented funnel', async () => {
  const events = ['cta_click', 'path_chosen', 'onboarding_completed', 'tree_created', 'import_completed', 'invite_accepted', 'first_contribution'];
  for (const event of events) {
    const db = mockDb();
    const res = await onRequestPost({ request: req({ event }), env: { DB: db } });
    assert.equal(res.status, 200, `${event} should be accepted`);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].args[1], event);
  }
});

await atest('a known path is preserved in the insert', async () => {
  const db = mockDb();
  await onRequestPost({ request: req({ event: 'path_chosen', path: 'import' }), env: { DB: db } });
  assert.equal(db.calls[0].args[2], 'import');
});

await atest('an unknown/arbitrary path is silently nulled, not passed through', async () => {
  const db = mockDb();
  await onRequestPost({ request: req({ event: 'cta_click', path: '<script>alert(1)</script>' }), env: { DB: db } });
  assert.equal(db.calls[0].args[2], null);
});

await atest('a missing path is stored as null', async () => {
  const db = mockDb();
  await onRequestPost({ request: req({ event: 'cta_click' }), env: { DB: db } });
  assert.equal(db.calls[0].args[2], null);
});

await atest('a DB write failure still returns ok:true (best-effort, never blocks the caller)', async () => {
  const env = {
    DB: {
      prepare() {
        return { bind: () => ({ run: async () => { throw new Error('boom'); } }) };
      },
    },
  };
  const res = await onRequestPost({ request: req({ event: 'cta_click' }), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
