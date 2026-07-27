/**
 * Unit tests for lib/ai.js's streamBio — the fix for a real user report
 * ("if I go to generate a story... it freezes... only a refresh clears it")
 * traced to no timeout anywhere in the connect-then-stream path, so a
 * stalled connection or a stream that goes silent mid-generation left the
 * caller's "generating…" state stuck forever. Mocks global fetch and a
 * ReadableStream reader — no real network call.
 * Run with: node tests/ai.test.mjs
 */
import assert from 'node:assert/strict';
import { streamBio } from '../src/lib/ai.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const realFetch = globalThis.fetch;
const enc = new TextEncoder();

// Builds a mock Response whose body reader yields the given SSE text
// chunks (already-formatted "event: ...\ndata: ...\n\n" blocks) in order,
// then signals done.
function sseResponse(chunks) {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { value: enc.encode(chunks[i++]), done: false };
            return { value: undefined, done: true };
          },
          async cancel() {},
        };
      },
    },
  };
}

function sseBlock(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

await atest('streamBio: a normal stream delivers every chunk and calls onDone, no error', async () => {
  globalThis.fetch = async () => sseResponse([
    sseBlock('content_block_delta', { delta: { type: 'text_delta', text: 'Once upon ' } }),
    sseBlock('content_block_delta', { delta: { type: 'text_delta', text: 'a time.' } }),
    sseBlock('message_stop', {}),
  ]);
  const chunks = [];
  let done = false, error = null;
  await streamBio({ id: 'p1' }, {}, { onChunk: (t) => chunks.push(t), onDone: () => { done = true; }, onError: (e) => { error = e; } });
  assert.equal(chunks.join(''), 'Once upon a time.');
  assert.equal(done, true);
  assert.equal(error, null);
});

await atest('streamBio: a non-ok response reports the server error message', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'model overloaded' }) });
  let error = null;
  await streamBio({ id: 'p1' }, {}, { onError: (e) => { error = e; } });
  assert.equal(error.message, 'model overloaded');
});

await atest('streamBio: a connection that never responds times out and reports a real error (not silently swallowed)', async () => {
  globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    });
  });
  let error = 'not called';
  await streamBio({ id: 'p1' }, {}, { onError: (e) => { error = e; }, connectTimeoutMs: 20 });
  assert.ok(error instanceof Error, 'a timeout must surface as a real Error, never null (that would silently swallow it)');
  assert.match(error.message, /timed out/i);
});

await atest('streamBio: a stream that connects fine but then goes silent (stalls) reports an error instead of hanging forever', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
  });
  let error = 'not called';
  const start = Date.now();
  await streamBio({ id: 'p1' }, {}, { onError: (e) => { error = e; }, stallTimeoutMs: 20 });
  assert.ok(error instanceof Error);
  assert.match(error.message, /stopped generating/i);
  assert.ok(Date.now() - start < 2000, 'must report the stall promptly, not hang');
});

await atest('streamBio: an intentionally aborted (caller-cancelled) request reports null, not an error', async () => {
  const ac = new AbortController();
  // Matches the real Fetch spec: fetch() synchronously rejects if given an
  // already-aborted signal, rather than waiting on a future 'abort' event
  // that already happened and will never fire again.
  globalThis.fetch = async (url, opts) => {
    if (opts.signal.aborted) {
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }
    return new Promise(() => {});
  };
  ac.abort(); // caller cancelled before the request even completed
  let errorCalls = [];
  await streamBio({ id: 'p1' }, {}, { onError: (e) => errorCalls.push(e), signal: ac.signal, connectTimeoutMs: 20_000 });
  assert.deepEqual(errorCalls, [null], 'a deliberate cancellation must stay a silent no-op, not surface as an error');
});

globalThis.fetch = realFetch;
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
