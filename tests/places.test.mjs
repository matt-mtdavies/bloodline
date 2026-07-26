/**
 * Unit tests for lib/places.js's geocodePlaces — the batch client wrapper
 * used by store.js's backfillResidenceGeocodes to retroactively resolve
 * residences saved without coordinates. Mocks global fetch (same convention
 * as tests/geocode.test.mjs) — no real network call.
 * Run with: node tests/places.test.mjs
 */
import assert from 'node:assert/strict';
import { geocodePlaces } from '../src/lib/places.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

const realFetch = globalThis.fetch;

await atest('geocodePlaces: empty input never calls fetch and returns {}', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({ places: {} }) }; };
  const result = await geocodePlaces([]);
  assert.deepEqual(result, {});
  assert.equal(called, false);
});

await atest('geocodePlaces: dedupes input before sending to the server', async () => {
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ places: { 'Cardiff, Wales': { lat: 51.48, lon: -3.18 } } }) };
  };
  const result = await geocodePlaces(['Cardiff, Wales', 'Cardiff, Wales', '  Cardiff, Wales  ']);
  assert.equal(sentBody.places.length, 1, 'all three collapse to one distinct place once trimmed');
  assert.deepEqual(result['Cardiff, Wales'], { lat: 51.48, lon: -3.18 });
});

await atest('geocodePlaces: chunks more than 50 distinct places into sequential requests', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.places.length);
    const places = {};
    for (const p of body.places) places[p] = { lat: 0, lon: 0 };
    return { ok: true, json: async () => ({ places }) };
  };
  const input = Array.from({ length: 120 }, (_, i) => `Place ${i}`);
  const result = await geocodePlaces(input);
  assert.deepEqual(calls, [50, 50, 20], 'chunked at the 50-per-request cap');
  assert.equal(Object.keys(result).length, 120, 'every place across every chunk ends up in the merged result');
});

await atest('geocodePlaces: a failed chunk is skipped, not thrown — the rest of the batch still resolves', async () => {
  let call = 0;
  globalThis.fetch = async (url, opts) => {
    call++;
    if (call === 1) return { ok: false };
    const body = JSON.parse(opts.body);
    const places = {};
    for (const p of body.places) places[p] = { lat: 1, lon: 1 };
    return { ok: true, json: async () => ({ places }) };
  };
  const input = Array.from({ length: 60 }, (_, i) => `Place ${i}`); // 2 chunks: 50 + 10
  const result = await geocodePlaces(input);
  assert.equal(Object.keys(result).length, 10, 'only the second (successful) chunk of 10 makes it into the result');
});

await atest('geocodePlaces: a thrown/network error on one chunk does not abort the whole batch', async () => {
  let call = 0;
  globalThis.fetch = async (url, opts) => {
    call++;
    if (call === 1) throw new Error('network error');
    const body = JSON.parse(opts.body);
    const places = {};
    for (const p of body.places) places[p] = { lat: 2, lon: 2 };
    return { ok: true, json: async () => ({ places }) };
  };
  const input = Array.from({ length: 60 }, (_, i) => `Place ${i}`);
  const result = await geocodePlaces(input);
  assert.equal(Object.keys(result).length, 10);
});

globalThis.fetch = realFetch;

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
