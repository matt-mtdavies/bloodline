/**
 * Unit tests for lib/image.js's upload/read helpers — specifically that
 * uploadDocument/uploadPhoto/srcToDataUrl now go through lib/net.js's
 * fetchWithTimeout instead of a bare fetch(). Real user report: adding a
 * document or photo could "get caught, never finish," recoverable only by
 * a hard refresh — traced to these three being the one remaining place in
 * the app with no timeout at all, unlike every other network call (the
 * tree save, AI generation) which already used fetchWithTimeout.
 *
 * Mocks global fetch (same convention as tests/net.test.mjs) — no real
 * network call, and no real timers: uses a short timeoutMs so the tests
 * run fast while still exercising the real timeout path.
 * Run with: node tests/image.test.mjs
 */
import assert from 'node:assert/strict';
import { uploadDocument, uploadPhoto, srcToDataUrl } from '../src/lib/image.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const realFetch = globalThis.fetch;

// Same stand-in as tests/net.test.mjs: never settles on its own, but rejects
// with an AbortError the instant its signal is aborted.
function neverSettlingFetch() {
  return (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

const TINY_DATA_URL = 'data:image/jpeg;base64,/9k=';

await atest('uploadDocument: a normal fast upload returns the R2 URL', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ url: '/api/documents/abc.jpg' }) });
  const url = await uploadDocument(TINY_DATA_URL, { title: 'cert' });
  assert.equal(url, '/api/documents/abc.jpg');
});

await atest('uploadDocument: a stalled upload times out promptly and falls back to the original data URL, never hangs', async () => {
  globalThis.fetch = neverSettlingFetch();
  const start = Date.now();
  const url = await uploadDocument(TINY_DATA_URL, { title: 'cert', timeoutMs: 30 });
  assert.equal(url, TINY_DATA_URL, 'falls back exactly like a network error would');
  assert.ok(Date.now() - start < 2000, 'must resolve promptly after the timeout, not hang until a refresh');
});

await atest('uploadPhoto: a normal fast upload returns the R2 URL', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ url: '/api/photos/abc.jpg' }) });
  const url = await uploadPhoto(TINY_DATA_URL);
  assert.equal(url, '/api/photos/abc.jpg');
});

await atest('uploadPhoto: a stalled upload times out promptly and falls back to the original data URL, never hangs', async () => {
  globalThis.fetch = neverSettlingFetch();
  const start = Date.now();
  const url = await uploadPhoto(TINY_DATA_URL, { timeoutMs: 30 });
  assert.equal(url, TINY_DATA_URL);
  assert.ok(Date.now() - start < 2000, 'must resolve promptly after the timeout, not hang until a refresh');
});

await atest('srcToDataUrl: a data: URL passes through without ever calling fetch', async () => {
  globalThis.fetch = () => { throw new Error('must not be called'); };
  const out = await srcToDataUrl(TINY_DATA_URL);
  assert.equal(out, TINY_DATA_URL);
});

await atest('srcToDataUrl: a stalled read rejects promptly instead of hanging forever (callers already catch this — see App.jsx)', async () => {
  globalThis.fetch = neverSettlingFetch();
  const start = Date.now();
  await assert.rejects(
    () => srcToDataUrl('/api/documents/abc.jpg', { timeoutMs: 30 }),
    (e) => e.name === 'AbortError',
  );
  assert.ok(Date.now() - start < 2000, 'must reject promptly after the timeout, not hang until a refresh');
});

globalThis.fetch = realFetch;
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
