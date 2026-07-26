/**
 * Unit tests for functions/_lib/trove.js — Trove (NLA) search/fetch logic.
 * Mocks fetch entirely (an injected function, not global.fetch) — no real
 * network or API key needed. Response fixtures are built from Trove's
 * published API v3 docs; see the module's own header comment for the
 * disclosed caveat that the real shape hasn't been confirmed live yet.
 * Run with: node tests/trove.test.mjs
 */
import assert from 'node:assert/strict';
import {
  buildTroveQuery, normalizeSearchResponse, searchTrove, fetchArticleText,
} from '../functions/_lib/trove.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── buildTroveQuery ──────────────────────────────────────────────────────────

await test('buildTroveQuery: name alone', () => {
  assert.equal(buildTroveQuery({ name: 'Arthur Mercer' }), 'Arthur Mercer');
});

await test('buildTroveQuery: name plus place', () => {
  assert.equal(buildTroveQuery({ name: 'Arthur Mercer', place: 'Cardiff' }), 'Arthur Mercer Cardiff');
});

await test('buildTroveQuery: no place, no trailing whitespace', () => {
  assert.equal(buildTroveQuery({ name: 'Arthur Mercer', place: null }), 'Arthur Mercer');
});

// ── normalizeSearchResponse ──────────────────────────────────────────────────

await test('normalizeSearchResponse: newspaper + gazette + people categories all flatten into one list', () => {
  const body = {
    category: [
      {
        code: 'newspaper',
        records: {
          article: [
            { id: '123', category: 'Family Notices', heading: 'MARRIAGE', date: '1930-05-14', title: { value: 'The Sydney Morning Herald' }, page: 8, snippet: 'SMITH—JONES...', troveUrl: 'https://trove.nla.gov.au/newspaper/article/123' },
          ],
        },
      },
      {
        code: 'gazette',
        records: {
          article: [
            { id: '456', category: 'Government Gazette Notices', heading: 'ENLISTMENT', date: '1916-02-01', title: { value: 'Commonwealth Gazette' }, page: 3, snippet: 'Private J. Mercer...', troveUrl: 'https://trove.nla.gov.au/gazette/article/456' },
          ],
        },
      },
      {
        code: 'people',
        records: {
          people: [
            { id: '789', primaryDisplayName: 'Arthur Mercer', biography: [{ text: 'Railway engineer.' }] },
          ],
        },
      },
    ],
  };
  const results = normalizeSearchResponse(body);
  assert.equal(results.length, 3);
  assert.equal(results[0].category, 'newspaper');
  assert.equal(results[0].articleType, 'Family Notices');
  assert.equal(results[0].heading, 'MARRIAGE');
  assert.equal(results[1].category, 'gazette');
  assert.equal(results[2].category, 'people');
  assert.equal(results[2].heading, 'Arthur Mercer');
  assert.equal(results[2].snippet, 'Railway engineer.');
});

await test('normalizeSearchResponse: a single result comes back as a bare object, not a one-item array — still normalized', () => {
  const body = {
    category: [
      { code: 'newspaper', records: { article: { id: '1', heading: 'BIRTH', date: '1901-01-01' } } },
    ],
  };
  const results = normalizeSearchResponse(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '1');
});

await test('normalizeSearchResponse: an unrecognized category (e.g. book, image) is silently skipped, not guessed at', () => {
  const body = {
    category: [
      { code: 'book', records: { work: [{ id: '99' }] } },
      { code: 'newspaper', records: { article: [{ id: '1', heading: 'X' }] } },
    ],
  };
  const results = normalizeSearchResponse(body);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '1');
});

await test('normalizeSearchResponse: malformed/missing shape degrades to an empty list, never throws', () => {
  assert.deepEqual(normalizeSearchResponse(null), []);
  assert.deepEqual(normalizeSearchResponse({}), []);
  assert.deepEqual(normalizeSearchResponse({ category: [{ code: 'newspaper' }] }), []);
  assert.deepEqual(normalizeSearchResponse({ category: [{ code: 'newspaper', records: { article: [{}] } }] }), []);
});

// ── searchTrove ──────────────────────────────────────────────────────────────

await test('searchTrove: builds the expected URL and headers, returns normalized results', async () => {
  let capturedUrl, capturedHeaders;
  const fetchImpl = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return {
      ok: true,
      json: async () => ({ category: [{ code: 'newspaper', records: { article: [{ id: '1', heading: 'BIRTH' }] } }] }),
    };
  };
  const { results } = await searchTrove(fetchImpl, 'test-key', { name: 'Arthur Mercer', place: 'Cardiff' });
  assert.equal(results.length, 1);
  assert.equal(capturedHeaders['X-API-KEY'], 'test-key');
  assert.ok(capturedUrl.startsWith('https://api.trove.nla.gov.au/v3/result?'));
  assert.ok(capturedUrl.includes('q=Arthur+Mercer+Cardiff'));
  assert.ok(capturedUrl.includes('category=newspaper%2Cgazette%2Cpeople'));
});

await test('searchTrove: missing name is a validation error, never calls fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const { error } = await searchTrove(fetchImpl, 'test-key', { name: '' });
  assert.ok(error);
  assert.equal(called, false);
});

await test('searchTrove: a non-ok upstream status is surfaced as an error, not thrown', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  const { error, detail } = await searchTrove(fetchImpl, 'bad-key', { name: 'Arthur Mercer' });
  assert.match(error, /403/);
  assert.equal(detail, 'Forbidden');
});

await test('searchTrove: a network failure (fetch throws) is caught and reported, not thrown', async () => {
  const fetchImpl = async () => { throw new Error('DNS failure'); };
  const { error } = await searchTrove(fetchImpl, 'test-key', { name: 'Arthur Mercer' });
  assert.ok(error);
});

await test('searchTrove: malformed (non-JSON) response body is reported, not thrown', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
  const { error } = await searchTrove(fetchImpl, 'test-key', { name: 'Arthur Mercer' });
  assert.ok(error);
});

// ── fetchArticleText ─────────────────────────────────────────────────────────

await test('fetchArticleText: inline article text is returned directly', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ articleText: 'MARRIAGE. Smith-Jones...', wordCount: 42, heading: 'MARRIAGE', date: '1930-05-14' }),
  });
  const article = await fetchArticleText(fetchImpl, 'test-key', { id: '123', category: 'newspaper' });
  assert.equal(article.text, 'MARRIAGE. Smith-Jones...');
  assert.equal(article.wordCount, 42);
});

await test('fetchArticleText: articleText as a URL is followed with a second fetch, and HTML is stripped', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ articleText: 'https://trove.nla.gov.au/text/123.txt' }) };
    assert.equal(url, 'https://trove.nla.gov.au/text/123.txt');
    return { ok: true, text: async () => '<p>MARRIAGE.</p> <p>Smith-Jones.</p>' };
  };
  const article = await fetchArticleText(fetchImpl, 'test-key', { id: '123', category: 'newspaper' });
  assert.equal(calls, 2);
  assert.equal(article.text, 'MARRIAGE. Smith-Jones.');
});

await test('fetchArticleText: rejects a category that cannot have article text (e.g. people)', async () => {
  const { error } = await fetchArticleText(async () => ({}), 'test-key', { id: '1', category: 'people' });
  assert.ok(error);
});

await test('fetchArticleText: a non-ok upstream status is surfaced as an error, not thrown', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'Server error' });
  const { error } = await fetchArticleText(fetchImpl, 'test-key', { id: '1', category: 'newspaper' });
  assert.match(error, /500/);
});

await test('fetchArticleText: no articleText field at all still returns other citation fields, text is null', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ heading: 'X', date: '1900-01-01' }) });
  const article = await fetchArticleText(fetchImpl, 'test-key', { id: '1', category: 'gazette' });
  assert.equal(article.text, null);
  assert.equal(article.heading, 'X');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
