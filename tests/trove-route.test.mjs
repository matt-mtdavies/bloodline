/**
 * Unit tests for functions/api/trove/search.js and .../article.js — the thin
 * route files over functions/_lib/trove.js (logic covered by
 * tests/trove.test.mjs) and functions/_lib/documentExtraction.js (covered by
 * tests/summarize.test.mjs). Only the env/auth/validation glue and the
 * citation+extraction stitching are tested here. Mocks global.fetch.
 * Run with: node tests/trove-route.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet as searchGet } from '../functions/api/trove/search.js';
import { onRequestGet as articleGet } from '../functions/api/trove/article.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function req(url) { return { url }; }

// ── /api/trove/search ────────────────────────────────────────────────────────

await test('GET /api/trove/search: 503 when TROVE_API_KEY is not configured', async () => {
  const res = await searchGet({ request: req('https://x/api/trove/search?name=Arthur+Mercer'), env: {} });
  assert.equal(res.status, 503);
});

await test('GET /api/trove/search: 400 when name is missing, never calls fetch', async () => {
  let called = false;
  global.fetch = async () => { called = true; };
  const res = await searchGet({ request: req('https://x/api/trove/search'), env: { TROVE_API_KEY: 'k' } });
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

await test('GET /api/trove/search: success passes normalized results through', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ category: [{ code: 'newspaper', records: { article: [{ id: '1', heading: 'BIRTH' }] } }] }),
  });
  const res = await searchGet({ request: req('https://x/api/trove/search?name=Arthur+Mercer'), env: { TROVE_API_KEY: 'k' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results.length, 1);
});

await test('GET /api/trove/search: an upstream error surfaces as 502, not a crash', async () => {
  global.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  const res = await searchGet({ request: req('https://x/api/trove/search?name=Arthur+Mercer'), env: { TROVE_API_KEY: 'k' } });
  assert.equal(res.status, 502);
});

// ── /api/trove/article ───────────────────────────────────────────────────────

await test('GET /api/trove/article: 503 when TROVE_API_KEY is not configured', async () => {
  const res = await articleGet({ request: req('https://x/api/trove/article?id=1&category=newspaper'), env: {}, data: {} });
  assert.equal(res.status, 503);
});

await test('GET /api/trove/article: 400 on a missing/invalid category', async () => {
  const res = await articleGet({
    request: req('https://x/api/trove/article?id=1&category=book'),
    env: { TROVE_API_KEY: 'k' }, data: {},
  });
  assert.equal(res.status, 400);
});

await test('GET /api/trove/article: no ANTHROPIC_API_KEY still returns the raw citation, not an error', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ articleText: 'MARRIAGE. Smith-Jones.', heading: 'MARRIAGE', date: '1930-05-14', title: { value: 'SMH' } }),
  });
  const res = await articleGet({
    request: req('https://x/api/trove/article?id=1&category=newspaper'),
    env: { TROVE_API_KEY: 'k' }, data: {},
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.text, 'MARRIAGE. Smith-Jones.');
  assert.equal(body.summary, null);
  assert.deepEqual(body.facts, []);
});

await test('GET /api/trove/article: with both keys, the article text is run through extraction and the citation is preserved', async () => {
  let call = 0;
  global.fetch = async (url) => {
    call++;
    if (call === 1) {
      // The Trove article fetch.
      return { ok: true, json: async () => ({ articleText: 'MARRIAGE. John SMITH to Jane DOE, 12th May, at Cardiff.', heading: 'MARRIAGE', date: '1930-05-14', title: { value: 'SMH' }, troveUrl: 'https://trove.nla.gov.au/x/1' }) };
    }
    // The Anthropic extraction call.
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    return {
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({
          summary: 'A marriage notice.', facts: [{ year: '1930', title: 'Married', detail: null, quote: 'MARRIAGE. John SMITH to Jane DOE', tag: null }],
          profile_fields: null, people_mentioned: [], medals: [],
        }) }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    };
  };
  const res = await articleGet({
    request: req('https://x/api/trove/article?id=1&category=newspaper'),
    env: { TROVE_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }, data: { user: null },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.heading, 'MARRIAGE');
  assert.equal(body.troveUrl, 'https://trove.nla.gov.au/x/1');
  assert.equal(body.summary, 'A marriage notice.');
  assert.equal(body.facts.length, 1);
  assert.equal(call, 2);
});

await test('GET /api/trove/article: extraction failure still returns the raw citation, not a hard error', async () => {
  let call = 0;
  global.fetch = async () => {
    call++;
    if (call === 1) return { ok: true, json: async () => ({ articleText: 'MARRIAGE.', heading: 'MARRIAGE', date: '1930-05-14' }) };
    return { ok: false, status: 529, text: async () => 'overloaded' };
  };
  const res = await articleGet({
    request: req('https://x/api/trove/article?id=1&category=newspaper'),
    env: { TROVE_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }, data: { user: null },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.heading, 'MARRIAGE');
  assert.equal(body.summary, null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
