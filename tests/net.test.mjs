/**
 * Unit tests for lib/net.js's fetchWithTimeout — the fix for a real user
 * report ("the app freezes during a save or an AI generation, only a
 * refresh clears it") traced to fetch() having no built-in timeout, so a
 * stalled connection left the app's sync/AI-generation state stuck in its
 * "in progress" phase forever. Mocks global fetch (same convention as
 * tests/places.test.mjs) — no real network call.
 * Run with: node tests/net.test.mjs
 */
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/lib/net.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const realFetch = globalThis.fetch;

// A stand-in for a stalled real fetch: never settles on its own, but
// (matching real fetch's own contract) rejects with an AbortError the
// instant its signal is aborted — this is what lets fetchWithTimeout's own
// timer-driven abort actually resolve the returned promise in these tests.
function neverSettlingFetch() {
  return (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

await atest('fetchWithTimeout: a normal, fast response resolves normally, timeout never fires', async () => {
  globalThis.fetch = async (url, opts) => ({ ok: true, url, gotSignal: !!opts.signal });
  const res = await fetchWithTimeout('/api/tree', {}, 5000);
  assert.equal(res.ok, true);
  assert.equal(res.gotSignal, true, 'the real fetch always receives an AbortSignal, even on the fast path');
});

await atest('fetchWithTimeout: a stalled request is aborted once the timeout elapses, rejecting instead of hanging forever', async () => {
  globalThis.fetch = neverSettlingFetch();
  const start = Date.now();
  await assert.rejects(
    () => fetchWithTimeout('/api/tree', {}, 30),
    (e) => e.name === 'AbortError',
  );
  assert.ok(Date.now() - start < 2000, 'must reject promptly after the timeout, not hang');
});

await atest('fetchWithTimeout: an externally-supplied signal aborts the request too, independent of the timeout', async () => {
  globalThis.fetch = neverSettlingFetch();
  const ac = new AbortController();
  const p = fetchWithTimeout('/api/tree', { signal: ac.signal }, 60_000); // long timeout — must not be what fires
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(() => p, (e) => e.name === 'AbortError');
});

await atest('fetchWithTimeout: an already-aborted external signal aborts immediately, never calling the real fetch with a live signal', async () => {
  let sawAbortedSignal = false;
  // Matches the real Fetch spec: fetch() synchronously rejects if the
  // signal it's given is already aborted, rather than waiting for a future
  // 'abort' event that has already happened and will never fire again.
  globalThis.fetch = async (url, opts) => {
    sawAbortedSignal = opts.signal.aborted;
    if (opts.signal.aborted) {
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }
    return new Promise(() => {});
  };
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => fetchWithTimeout('/api/tree', { signal: ac.signal }, 60_000),
    (e) => e.name === 'AbortError',
  );
  assert.equal(sawAbortedSignal, true);
});

await atest('fetchWithTimeout: options other than signal (method, headers, body) pass through untouched', async () => {
  let received = null;
  globalThis.fetch = async (url, opts) => { received = opts; return { ok: true }; };
  await fetchWithTimeout('/api/tree', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"x":1}' }, 5000);
  assert.equal(received.method, 'PUT');
  assert.equal(received.headers['content-type'], 'application/json');
  assert.equal(received.body, '{"x":1}');
});

globalThis.fetch = realFetch;
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
