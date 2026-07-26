/**
 * Unit tests for src/lib/externalArchives.js — country detection and the
 * "which archives to suggest" filtering. Pure, no network/DOM needed.
 * Run with: node tests/externalArchives.test.mjs
 */
import assert from 'node:assert/strict';
import { detectCountries, getRelevantArchives, buildArchiveUrl, ARCHIVES } from '../src/lib/externalArchives.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── detectCountries ──────────────────────────────────────────────────────────

test('detectCountries: matches Australia via a state name', () => {
  const found = detectCountries({ birth_place: 'Sydney, New South Wales' });
  assert.ok(found.has('AU'));
  assert.equal(found.size, 1, 'must not also match UK off "Wales" inside "New South Wales"');
});

test('detectCountries: "New South Wales" never triggers a false UK match', () => {
  const found = detectCountries({ residence: 'Some town, NSW, Australia' });
  assert.ok(found.has('AU'));
  assert.ok(!found.has('UK'));
});

test('detectCountries: matches UK via a constituent country name', () => {
  const found = detectCountries({ birth_place: 'Cardiff, Wales' });
  assert.ok(found.has('UK'));
  assert.equal(found.size, 1);
});

test('detectCountries: matches Canada via a province name', () => {
  const found = detectCountries({ birth_place: 'Toronto, Ontario' });
  assert.ok(found.has('CA'));
});

test('detectCountries: a person with places in two different countries matches both', () => {
  const found = detectCountries({ birth_place: 'Bristol, England', death_place: 'Melbourne, Victoria' });
  assert.ok(found.has('UK'));
  assert.ok(found.has('AU'));
  assert.equal(found.size, 2);
});

test('detectCountries: military_nation is matched directly, independent of place fields', () => {
  const found = detectCountries({ military_nation: 'Australia' });
  assert.ok(found.has('AU'));
});

test('detectCountries: no place data at all returns an empty set, not a guess', () => {
  const found = detectCountries({ display_name: 'Someone With No Places' });
  assert.equal(found.size, 0);
});

test('detectCountries: null/undefined person is handled without throwing', () => {
  assert.equal(detectCountries(null).size, 0);
  assert.equal(detectCountries(undefined).size, 0);
});

// ── getRelevantArchives ──────────────────────────────────────────────────────

test('getRelevantArchives: an Australian person gets AU archives plus the cross-cutting ones', () => {
  const list = getRelevantArchives({ birth_place: 'Melbourne, Victoria' });
  const ids = list.map((a) => a.id);
  assert.ok(ids.includes('trove'));
  assert.ok(ids.includes('vic-bdm'));
  assert.ok(ids.includes('cwgc'), 'cross-cutting entries must always be included');
  assert.ok(ids.includes('ancestry'), 'global/commercial entries must always be included');
  assert.ok(!ids.includes('lac'), 'a Canada-only archive should not show for an Australian person');
  assert.ok(!ids.includes('freebmd'), 'a UK-only archive should not show for an Australian person');
});

test('getRelevantArchives: a person matching two countries gets both groups, no duplicates', () => {
  const list = getRelevantArchives({ birth_place: 'Cardiff, Wales', residence: 'Sydney, NSW' });
  const ids = list.map((a) => a.id);
  assert.ok(ids.includes('trove'));
  assert.ok(ids.includes('freebmd'));
  assert.equal(new Set(ids).size, ids.length, 'no archive should ever be listed twice');
});

test('getRelevantArchives: no detectable country still returns the cross-cutting/global set, not an empty list', () => {
  const list = getRelevantArchives({ display_name: 'Someone With No Places' });
  const ids = list.map((a) => a.id);
  assert.ok(ids.includes('cwgc'));
  assert.ok(ids.includes('ancestry'));
  assert.ok(!ids.includes('trove'), 'country-specific archives must not appear without a detected country');
});

// ── buildArchiveUrl ──────────────────────────────────────────────────────────

test('buildArchiveUrl: a prefillable archive (Trove) builds a real search URL from the name', () => {
  const trove = ARCHIVES.find((a) => a.id === 'trove');
  const url = buildArchiveUrl(trove, { name: 'Arthur Mercer' });
  assert.match(url, /^https:\/\/trove\.nla\.gov\.au\/search\/category\/newspapers\?keyword=/);
  assert.ok(url.includes(encodeURIComponent('Arthur Mercer')));
});

test('buildArchiveUrl: Ancestry builds its documented gsfn/gsln/msbdy query params', () => {
  const ancestry = ARCHIVES.find((a) => a.id === 'ancestry');
  const url = buildArchiveUrl(ancestry, { givenName: 'Arthur', surname: 'Mercer', birthYear: 1928 });
  assert.match(url, /gsfn=Arthur/);
  assert.match(url, /gsln=Mercer/);
  assert.match(url, /msbdy=1928/);
});

test('buildArchiveUrl: a non-prefillable archive always returns its own static URL, ignoring person fields', () => {
  const vicBdm = ARCHIVES.find((a) => a.id === 'vic-bdm');
  const url = buildArchiveUrl(vicBdm, { name: 'Arthur Mercer' });
  assert.equal(url, vicBdm.url);
});

test('every ARCHIVES entry is internally consistent: prefill:true implies a buildUrl, prefill:false implies a static url', () => {
  for (const a of ARCHIVES) {
    if (a.prefill) assert.equal(typeof a.buildUrl, 'function', `${a.id} claims prefill but has no buildUrl`);
    else assert.equal(typeof a.url, 'string', `${a.id} claims no prefill but has no static url`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
