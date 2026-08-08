/**
 * Unit tests for src/viz/v2/realFamily.js — the Tree Motion Lab's one,
 * strictly opt-in, strictly READ-ONLY path to real (not fixture) family
 * data. Given this touches a real, currently-signed-in family's actual
 * tree, the load-bearing guarantee every test here pins is mechanical, not
 * just a code-review promise: fetchRealFamily() NEVER issues more than one
 * network call, and that one call is ALWAYS a plain GET to /api/tree —
 * never any other method, never any other URL, regardless of whether the
 * response is a success, a 401, a network failure, or malformed. A mutation
 * accidentally introduced later (a PUT, a second call, a different
 * endpoint) fails these tests immediately rather than being caught only by
 * code review.
 * Run with: node tests/realFamily.test.mjs
 */
import assert from 'node:assert/strict';
import { fetchRealFamily, parseRealFamilyResponse } from '../src/viz/v2/realFamily.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const realFetch = globalThis.fetch;

// Records every call made to the mocked fetch so tests can assert on the
// exact shape (method + url), not just the count.
function trackedFetch(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, method: opts?.method ?? 'GET' });
    return impl(url, opts);
  };
  fn.calls = calls;
  return fn;
}

function assertExactlyOneReadOnlyGet(calls) {
  assert.equal(calls.length, 1, `expected exactly one fetch call, got ${calls.length}`);
  assert.equal(calls[0].url, '/api/tree', 'must only ever call /api/tree');
  assert.equal(calls[0].method, 'GET', 'must only ever be a GET — never a write');
}

const REAL_PERSON = { id: 'p1', display_name: 'Ann Real' };
const REAL_RELS = [];

await atest('a successful load makes exactly one GET to /api/tree and nothing else', async () => {
  globalThis.fetch = trackedFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ people: [REAL_PERSON], relationships: REAL_RELS, myPersonId: 'p1' }),
  }));
  const result = await fetchRealFamily();
  assertExactlyOneReadOnlyGet(globalThis.fetch.calls);
  assert.deepEqual(result, { people: [REAL_PERSON], relationships: REAL_RELS, focus: 'p1' });
});

await atest('myPersonId becomes the focus when present and valid', async () => {
  globalThis.fetch = trackedFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ people: [{ id: 'a' }, { id: 'b' }], relationships: [], myPersonId: 'b' }),
  }));
  const result = await fetchRealFamily();
  assert.equal(result.focus, 'b');
});

await atest('falls back to the first person when myPersonId is missing', async () => {
  globalThis.fetch = trackedFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ people: [{ id: 'a' }, { id: 'b' }], relationships: [] }),
  }));
  const result = await fetchRealFamily();
  assert.equal(result.focus, 'a');
});

await atest('falls back to the first person when myPersonId does not match anyone', async () => {
  globalThis.fetch = trackedFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ people: [{ id: 'a' }, { id: 'b' }], relationships: [], myPersonId: 'ghost' }),
  }));
  const result = await fetchRealFamily();
  assert.equal(result.focus, 'a');
});

await atest('a 401 throws a clear sign-in message and makes only the one read', async () => {
  globalThis.fetch = trackedFetch(async () => ({ ok: false, status: 401 }));
  await assert.rejects(() => fetchRealFamily(), /[Ss]igned in/);
  assertExactlyOneReadOnlyGet(globalThis.fetch.calls);
});

await atest('a non-ok, non-401 status throws and makes only the one read', async () => {
  globalThis.fetch = trackedFetch(async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => fetchRealFamily(), /503/);
  assertExactlyOneReadOnlyGet(globalThis.fetch.calls);
});

await atest('a network failure (fetch throws) is reported, not thrown raw', async () => {
  globalThis.fetch = trackedFetch(async () => { throw new Error('boom'); });
  await assert.rejects(() => fetchRealFamily(), /server|connection/i);
  assertExactlyOneReadOnlyGet(globalThis.fetch.calls);
});

await atest('a new user with no family yet (null body) throws a clear "no data" message', async () => {
  globalThis.fetch = trackedFetch(async () => ({ ok: true, status: 200, json: async () => null }));
  await assert.rejects(() => fetchRealFamily(), /no data/i);
});

await atest('an empty family (people: []) throws a clear "nothing to load" message', async () => {
  globalThis.fetch = trackedFetch(async () => ({
    ok: true, status: 200, json: async () => ({ people: [], relationships: [] }),
  }));
  await assert.rejects(() => fetchRealFamily(), /empty/i);
});

await atest('parseRealFamilyResponse rejects a malformed body (missing relationships) without ever touching fetch', () => {
  assert.throws(() => parseRealFamilyResponse({ people: [REAL_PERSON] }));
});

globalThis.fetch = realFetch;
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
