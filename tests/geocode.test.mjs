/**
 * Unit tests for functions/_lib/geocode.js — the Nominatim proxy + D1 cache
 * behind Family Moments' geography insight. Mocks both fetch and D1 (same
 * conventions as tests/familysearch.test.mjs and tests/exportService.test.mjs
 * respectively) — no real network call, no real database.
 * Run with: node tests/geocode.test.mjs
 */
import assert from 'node:assert/strict';
import { geocodePlaces } from '../functions/_lib/geocode.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}\n${e.stack?.split('\n').slice(1, 3).join('\n')}`); }
}

function makeFakeDB(seedRows = []) {
  const rows = new Map(seedRows.map((r) => [r.place_key, r]));
  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() {
        if (sql.includes('SELECT lat, lon, status, suburb, state, country FROM place_geocode WHERE place_key')) {
          return rows.get(args[0]) || null;
        }
        throw new Error(`fakeDB: unhandled .first(): ${sql}`);
      },
      async run() {
        if (sql.includes('INSERT INTO place_geocode')) {
          // Two distinct statement shapes distinguished by their own literal
          // SQL text (the status value isn't a bound param in either) —
          // mirrors exactly how the real two branches in putCached differ.
          if (sql.includes("'ok'")) {
            const [key, displayName, lat, lon, suburb, state, country] = args;
            rows.set(key, { place_key: key, display_name: displayName, lat, lon, status: 'ok', suburb, state, country });
          } else {
            const [key] = args;
            rows.set(key, { place_key: key, display_name: null, lat: null, lon: null, status: 'not_found', suburb: null, state: null, country: null });
          }
          return { success: true };
        }
        throw new Error(`fakeDB: unhandled .run(): ${sql}`);
      },
    };
  }
  return { env: { DB: { prepare: (sql) => stmt(sql) } }, rows };
}

function nominatimResult(lat, lon, displayName = 'Somewhere', address = null) {
  return [{ lat: String(lat), lon: String(lon), display_name: displayName, address }];
}

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

await atest('geocodePlaces: two distinct places, both cache misses, both fetched and cached', async () => {
  const { env, rows } = makeFakeDB();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes('Cardiff')) return { ok: true, json: async () => nominatimResult(51.48, -3.18, 'Cardiff, Wales, UK') };
    return { ok: true, json: async () => nominatimResult(51.5, -0.12, 'London, UK') };
  };
  globalThis.setTimeout = (fn) => { fn(); return 0; }; // don't actually wait in tests

  const result = await geocodePlaces(env, ['Cardiff, Wales', 'London, England']);
  assert.equal(calls.length, 2, 'both places should be fetched — neither was cached');
  assert.deepEqual(result['Cardiff, Wales'], { lat: 51.48, lon: -3.18, suburb: null, state: null, country: null });
  assert.deepEqual(result['London, England'], { lat: 51.5, lon: -0.12, suburb: null, state: null, country: null });
  assert.equal(rows.get('cardiff, wales').status, 'ok');
  assert.equal(rows.get('london, england').status, 'ok');
});

await atest('geocodePlaces: a place already cached as "ok" is never re-fetched', async () => {
  const { env } = makeFakeDB([{ place_key: 'cardiff, wales', display_name: 'Cardiff', lat: 51.48, lon: -3.18, status: 'ok', suburb: null, state: 'Wales', country: 'United Kingdom' }]);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => nominatimResult(0, 0) }; };
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Cardiff, Wales']);
  assert.equal(calls, 0, 'a cache hit must never trigger a Nominatim request');
  assert.deepEqual(result['Cardiff, Wales'], { lat: 51.48, lon: -3.18, suburb: null, state: 'Wales', country: 'United Kingdom' });
});

await atest('geocodePlaces: a place cached as "not_found" returns null without re-fetching', async () => {
  const { env } = makeFakeDB([{ place_key: 'nowhereville', display_name: null, lat: null, lon: null, status: 'not_found' }]);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => [] }; };
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Nowhereville']);
  assert.equal(calls, 0);
  assert.equal(result['Nowhereville'], null);
});

await atest('geocodePlaces: two places normalizing to the same key are fetched exactly once', async () => {
  const { env } = makeFakeDB();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => nominatimResult(51.48, -3.18) }; };
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Cardiff, Wales', '  cardiff, wales  ']);
  assert.equal(calls, 1, 'the second string differs only by whitespace/casing — must not double-fetch');
  assert.deepEqual(result['Cardiff, Wales'], { lat: 51.48, lon: -3.18, suburb: null, state: null, country: null });
  assert.deepEqual(result['  cardiff, wales  '], { lat: 51.48, lon: -3.18, suburb: null, state: null, country: null }, 'the original (unnormalized) string is still a valid output key');
});

await atest('geocodePlaces: address breakdown is parsed into suburb/state/country and cached', async () => {
  const { env, rows } = makeFakeDB();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => nominatimResult(-37.7, 145.2, 'Fountain Gate, Victoria, Australia', {
      suburb: 'Fountain Gate', state: 'Victoria', country: 'Australia', country_code: 'au', postcode: '3805',
    }),
  });
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Fountain Gate, Victoria']);
  assert.deepEqual(result['Fountain Gate, Victoria'], { lat: -37.7, lon: 145.2, suburb: 'Fountain Gate', state: 'Victoria', country: 'Australia' });
  const row = rows.get('fountain gate, victoria');
  assert.equal(row.suburb, 'Fountain Gate');
  assert.equal(row.state, 'Victoria');
  assert.equal(row.country, 'Australia');
});

await atest('geocodePlaces: a village-level result falls back through the suburb synonym chain', async () => {
  const { env } = makeFakeDB();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => nominatimResult(52.1, -1.5, 'Little Wittering', { village: 'Little Wittering', county: 'Warwickshire', country: 'United Kingdom' }),
  });
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Little Wittering']);
  assert.equal(result['Little Wittering'].suburb, 'Little Wittering');
  assert.equal(result['Little Wittering'].state, null, 'no state/province field present — must not invent one from county');
  assert.equal(result['Little Wittering'].country, 'United Kingdom');
});

await atest('geocodePlaces: a genuine empty Nominatim result is cached as not_found and returned as null', async () => {
  const { env, rows } = makeFakeDB();
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const result = await geocodePlaces(env, ['Asdfghjkl Nonexistent Place']);
  assert.equal(result['Asdfghjkl Nonexistent Place'], null);
  assert.equal(rows.get('asdfghjkl nonexistent place').status, 'not_found');
});

await atest('geocodePlaces: a transient fetch failure returns null for that request but is NOT cached — a later call retries', async () => {
  const { env, rows } = makeFakeDB();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network error'); };
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  const first = await geocodePlaces(env, ['Cardiff, Wales']);
  assert.equal(first['Cardiff, Wales'], null);
  assert.equal(rows.has('cardiff, wales'), false, 'a transient failure must never poison the cache');

  const second = await geocodePlaces(env, ['Cardiff, Wales']);
  assert.equal(calls, 2, 'an uncached failure must be retried on the next call, not silently skipped forever');
  assert.equal(second['Cardiff, Wales'], null);
});

await atest('geocodePlaces: sequential cache-miss requests are rate-limited to Nominatim\'s 1 req/sec policy', async () => {
  const { env } = makeFakeDB();
  globalThis.fetch = async () => ({ ok: true, json: async () => nominatimResult(0, 0) });
  const delays = [];
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); fn(); return 0; };

  await geocodePlaces(env, ['Place A', 'Place B', 'Place C']);
  // The first cache-miss fetch never waits (nothing fetched yet this call);
  // every SUBSEQUENT cache-miss fetch must wait close to the 1100ms policy
  // floor (allowing for the few ms of real synchronous work in between).
  assert.ok(delays.length >= 2, 'at least the 2nd and 3rd fetches must be rate-limited');
  for (const d of delays) assert.ok(d > 1000 && d <= 1100, `expected a ~1100ms rate-limit wait, got ${d}`);
});

globalThis.fetch = realFetch;
globalThis.setTimeout = realSetTimeout;

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
