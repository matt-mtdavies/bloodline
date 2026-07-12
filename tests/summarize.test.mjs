/**
 * Unit tests for functions/api/documents/summarize.js — the retry-on-
 * transient-error loop and the oversized-file guard added after reports of
 * documents that summarized fine once and then intermittently failed.
 * Mocks global.fetch so no real network/API key is needed.
 * Run with: node tests/summarize.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/documents/summarize.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${TINY_PNG}`;
const env = { ANTHROPIC_API_KEY: 'test-key' }; // no DB — logAiUsage no-ops
const data = { user: null };
const request = () => ({ json: async () => ({ file: dataUrl }) });

const okBody = () => ({
  content: [{ text: JSON.stringify({
    summary: 'A test document.', facts: [], profile_fields: null, people_mentioned: [], medals: [],
  }) }],
  usage: { input_tokens: 10, output_tokens: 10 },
});

function mockFetch(responses) {
  let call = 0;
  return async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return {
      ok: r.status < 300,
      status: r.status,
      text: async () => r.text ?? '',
      json: async () => r.json ?? {},
    };
  };
}

await test('succeeds immediately when the first attempt is fine — no retry', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => okBody() }; };
  const res = await onRequestPost({ request: request(), env, data });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.summary, 'A test document.');
  assert.equal(calls, 1);
});

await test('retries on 429 (rate limited) and succeeds once the upstream recovers', async () => {
  global.fetch = mockFetch([
    { status: 429, text: 'rate limited' },
    { status: 429, text: 'rate limited' },
    { status: 200, json: okBody() },
  ]);
  let calls = 0;
  const wrapped = global.fetch;
  global.fetch = async (...args) => { calls++; return wrapped(...args); };
  const res = await onRequestPost({ request: request(), env, data });
  assert.equal(res.status, 200);
  assert.equal(calls, 3, 'expected exactly 3 attempts (2 retries then success)');
});

await test('gives up after 3 attempts on a persistent 529 (overloaded)', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 529, text: async () => 'overloaded' }; };
  const res = await onRequestPost({ request: request(), env, data });
  assert.equal(res.status, 502);
  assert.equal(calls, 3, 'expected exactly 3 attempts before giving up');
});

await test('does not retry a non-retryable error (e.g. 400) — fails fast', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 400, text: async () => 'bad request' }; };
  const res = await onRequestPost({ request: request(), env, data });
  assert.equal(res.status, 502);
  assert.equal(calls, 1, 'a non-retryable status should not be retried');
});

await test('rejects an oversized file before ever calling fetch', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => okBody() }; };
  const hugeDataUrl = `data:image/png;base64,${'A'.repeat(21 * 1024 * 1024)}`;
  const res = await onRequestPost({
    request: { json: async () => ({ file: hugeDataUrl }) },
    env, data,
  });
  assert.equal(res.status, 413);
  assert.equal(calls, 0, 'an oversized file should be rejected before any upstream call');
});

await test('medals from a successful response are passed through to the client', async () => {
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      content: [{ text: JSON.stringify({
        summary: 'A discharge certificate.', facts: [], profile_fields: null, people_mentioned: [],
        medals: [{ name: 'Military Medal', detail: null, quote: 'Awarded the Military Medal' }],
      }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  });
  const res = await onRequestPost({ request: request(), env, data });
  const body = await res.json();
  assert.equal(body.medals.length, 1);
  assert.equal(body.medals[0].name, 'Military Medal');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
