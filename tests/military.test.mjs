/**
 * Unit tests for lib/military.js — the Military Service profile section's
 * data derivation. Everything here reads existing tags (events, document
 * facts); nothing is invented, so the section only appears when the
 * underlying data genuinely exists.
 * Run with: node tests/military.test.mjs
 */
import assert from 'node:assert/strict';
import {
  militaryEvents, militaryDocuments, militaryQuotes, serviceYears, hasMilitaryService,
} from '../src/lib/military.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('militaryEvents filters to only tag === "military", sorted by year', () => {
  const person = {
    events: [
      { year: 1946, title: 'Discharged', tag: 'military' },
      { year: 1942, title: 'Enlisted', tag: 'military' },
      { year: 1944, title: 'Married', tag: null },
    ],
  };
  const events = militaryEvents(person);
  assert.deepEqual(events.map((e) => e.title), ['Enlisted', 'Discharged']);
});

test('militaryEvents drops events with no year (no chronological slot)', () => {
  const person = { events: [{ year: null, title: 'Enlisted', tag: 'military' }] };
  assert.equal(militaryEvents(person).length, 0);
});

test('militaryEvents returns an empty array for a person with no events', () => {
  assert.deepEqual(militaryEvents({}), []);
  assert.deepEqual(militaryEvents(null), []);
});

test('militaryDocuments keeps only documents with at least one military-tagged fact', () => {
  const docs = [
    { id: 'a', extracted: { facts: [{ tag: 'military', quote: 'q' }] } },
    { id: 'b', extracted: { facts: [{ tag: null, quote: 'q' }] } },
    { id: 'c', extracted: {} },
  ];
  assert.deepEqual(militaryDocuments(docs).map((d) => d.id), ['a']);
});

test('militaryQuotes pulls only military-tagged facts that carry a quote, sorted by year', () => {
  const docs = [
    {
      title: 'Service record',
      extracted: {
        facts: [
          { tag: 'military', year: '1946', quote: 'Discharged with good conduct.' },
          { tag: 'military', year: '1942', quote: 'Enlisted for active service.' },
          { tag: 'military', year: '1943', quote: null }, // no quote — skipped
          { tag: null, year: '1944', quote: 'Married.' }, // not military — skipped
        ],
      },
    },
  ];
  const quotes = militaryQuotes(docs);
  assert.deepEqual(quotes.map((q) => q.quote), ['Enlisted for active service.', 'Discharged with good conduct.']);
  assert.equal(quotes[0].docTitle, 'Service record');
});

test('militaryQuotes is capped', () => {
  const facts = Array.from({ length: 5 }, (_, i) => ({ tag: 'military', year: String(1940 + i), quote: `q${i}` }));
  const docs = [{ title: 'Doc', extracted: { facts } }];
  assert.equal(militaryQuotes(docs, 3).length, 3);
});

test('serviceYears returns a single year when only one is recorded', () => {
  assert.equal(serviceYears([{ year: '1942' }]), '1942');
});

test('serviceYears returns a range spanning the earliest and latest year', () => {
  assert.equal(serviceYears([{ year: '1942' }, { year: '1944' }, { year: '1946' }]), '1942–1946');
});

test('serviceYears returns null with no events', () => {
  assert.equal(serviceYears([]), null);
});

test('hasMilitaryService is true when there are military-tagged events, even with no documents', () => {
  const person = { events: [{ year: 1942, title: 'Enlisted', tag: 'military' }] };
  assert.equal(hasMilitaryService(person, []), true);
});

test('hasMilitaryService is true when there are military-tagged documents, even with no events', () => {
  const person = { events: [] };
  const docs = [{ extracted: { facts: [{ tag: 'military', quote: 'q' }] } }];
  assert.equal(hasMilitaryService(person, docs), true);
});

test('hasMilitaryService is false for a person with neither', () => {
  const person = { events: [{ year: 1942, title: 'Married', tag: null }] };
  const docs = [{ extracted: { facts: [{ tag: null, quote: 'q' }] } }];
  assert.equal(hasMilitaryService(person, docs), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
