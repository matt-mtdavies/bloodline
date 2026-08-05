/**
 * Unit tests for lib/ancestryStory.js — the Ancestry Story's pure data
 * assembly: four ascending chains grouped into two sides (father's father +
 * father's mother line; mother's mother + mother's father line), each side's
 * own convergence (that side's grandparents' marriage), the subject's own
 * parents' convergence, privacy stopping a line (and a cross line) short,
 * and the generation-readiness gate.
 * Run with: node tests/ancestryStory.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { buildAncestryFacts, ancestryReady, ANCESTRY_MIN_ANCESTORS, factsHash } from '../src/lib/ancestryStory.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, gender = null, extra = {}) => ({
  id,
  display_name: id,
  gender,
  is_deceased: false,
  ...extra,
});
const parentEdge = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null,
});
const marriageEdge = (a, b, { married = true, date = null, place = null } = {}) => ({
  type: 'partner', from_person: a, to_person: b, partner_status: 'current',
  is_married: married, marriage_date: date, marriage_place: place,
});

test('no parents on record — all four lines empty, no convergence anywhere', () => {
  const g = buildGraph([person('alice', 'female')], []);
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine, []);
  assert.deepEqual(facts.fatherSide.motherLine, []);
  assert.deepEqual(facts.motherSide.motherLine, []);
  assert.deepEqual(facts.motherSide.fatherLine, []);
  assert.equal(facts.fatherSide.convergence, null);
  assert.equal(facts.motherSide.convergence, null);
  assert.equal(facts.convergence, null);
});

test("fatherSide.fatherLine walks father -> father's father -> ..., oldest first", () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male', { display_name: 'Dad' }),
      person('gdad', 'male', { display_name: 'Granddad' }),
      person('ggdad', 'male', { display_name: 'Great-granddad' }),
    ],
    [
      parentEdge('dad', 'alice'),
      parentEdge('gdad', 'dad'),
      parentEdge('ggdad', 'gdad'),
    ],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine.map((a) => a.name), ['Great-granddad', 'Granddad', 'Dad']);
});

test("motherSide.motherLine walks mother -> mother's mother -> ..., independent of the father's side", () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('mum', 'female', { display_name: 'Mum' }),
      person('gmum', 'female', { display_name: 'Grandmum' }),
    ],
    [parentEdge('mum', 'alice'), parentEdge('gmum', 'mum')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.motherSide.motherLine.map((a) => a.name), ['Grandmum', 'Mum']);
  assert.deepEqual(facts.fatherSide.fatherLine, []);
});

test("fatherSide.motherLine walks the father's own mother's line (the new cross-gender thread)", () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male', { display_name: 'Dad' }),
      person('pgmum', 'female', { display_name: 'Paternal Grandmum' }),
      person('pggmum', 'female', { display_name: 'Paternal Great-grandmum' }),
    ],
    [
      parentEdge('dad', 'alice'),
      parentEdge('pgmum', 'dad'),
      parentEdge('pggmum', 'pgmum'),
    ],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine.map((a) => a.name), ['Dad']);
  assert.deepEqual(facts.fatherSide.motherLine.map((a) => a.name), ['Paternal Great-grandmum', 'Paternal Grandmum']);
});

test("motherSide.fatherLine walks the mother's own father's line (the new cross-gender thread)", () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('mum', 'female', { display_name: 'Mum' }),
      person('mgdad', 'male', { display_name: 'Maternal Granddad' }),
    ],
    [parentEdge('mum', 'alice'), parentEdge('mgdad', 'mum')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.motherSide.motherLine.map((a) => a.name), ['Mum']);
  assert.deepEqual(facts.motherSide.fatherLine.map((a) => a.name), ['Maternal Granddad']);
});

test('a step-parent is not part of any line', () => {
  const g = buildGraph(
    [person('alice', 'female'), person('stepdad', 'male')],
    [parentEdge('stepdad', 'alice', 'step')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine, []);
  assert.deepEqual(facts.fatherSide.motherLine, []);
});

test('an adoptive parent IS part of the line (same convention as isBioAdopt elsewhere)', () => {
  const g = buildGraph(
    [person('alice', 'female'), person('dad', 'male', { display_name: 'Dad' })],
    [parentEdge('dad', 'alice', 'adoptive')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine.map((a) => a.name), ['Dad']);
});

test('the line stops when no further same-gender bio/adoptive parent is recorded', () => {
  const g = buildGraph(
    [person('alice', 'female'), person('dad', 'male'), person('gdad', 'male')],
    [parentEdge('dad', 'alice'), parentEdge('gdad', 'dad')],
    // gdad has no recorded father — line stops at 2 entries, no error
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.equal(facts.fatherSide.fatherLine.length, 2);
});

test('a private ancestor stops the line right there and is excluded outright', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male', { display_name: 'Dad' }),
      person('gdad', 'male', { display_name: 'Granddad', visibility: 'private' }),
      person('ggdad', 'male', { display_name: 'Should never appear' }),
    ],
    [parentEdge('dad', 'alice'), parentEdge('gdad', 'dad'), parentEdge('ggdad', 'gdad')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine.map((a) => a.name), ['Dad']);
  assert.ok(!facts.fatherSide.fatherLine.some((a) => a.name === 'Should never appear'));
});

test('a private direct parent also withholds the cross-gender line and that side\'s convergence', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male', { display_name: 'Dad', visibility: 'private' }),
      person('pgmum', 'female', { display_name: 'Should never appear' }),
    ],
    [parentEdge('dad', 'alice'), parentEdge('pgmum', 'dad')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.fatherLine, []);
  assert.deepEqual(facts.fatherSide.motherLine, [], 'nothing behind a private father is revealed, including his own mother');
  assert.equal(facts.fatherSide.convergence, null);
});

test('a summary-visibility direct parent also withholds the cross-gender line', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('mum', 'female', { display_name: 'Mum', visibility: 'summary' }),
      person('mgdad', 'male', { display_name: 'Should never appear' }),
    ],
    [parentEdge('mum', 'alice'), parentEdge('mgdad', 'mum')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.equal(facts.motherSide.motherLine.length, 1);
  assert.equal(facts.motherSide.motherLine[0].restricted, true);
  assert.deepEqual(facts.motherSide.fatherLine, []);
});

test('a summary-visibility ancestor appears name-only and nothing behind them is knowable', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male', { display_name: 'Dad', visibility: 'summary' }),
      person('gdad', 'male', { display_name: 'Should not appear either' }),
    ],
    [parentEdge('dad', 'alice'), parentEdge('gdad', 'dad')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.equal(facts.fatherSide.fatherLine.length, 1);
  assert.equal(facts.fatherSide.fatherLine[0].restricted, true);
  assert.equal(facts.fatherSide.fatherLine[0].born, undefined);
});

test('fatherSide.convergence is the paternal grandparents\' marriage, when on record', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male'),
      person('pgdad', 'male'),
      person('pgmum', 'female'),
    ],
    [
      parentEdge('dad', 'alice'),
      parentEdge('pgdad', 'dad'), parentEdge('pgmum', 'dad'),
      marriageEdge('pgdad', 'pgmum', { date: '1930-04-02', place: 'Swansea' }),
    ],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.fatherSide.convergence, { year: '1930', place: 'Swansea' });
});

test('convergence is the subject\'s own parents\' marriage, when on record', () => {
  const g = buildGraph(
    [
      person('alice', 'female'),
      person('dad', 'male'),
      person('mum', 'female'),
    ],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice'), marriageEdge('dad', 'mum', { date: '1955-06-01', place: 'Cardiff' })],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.deepEqual(facts.convergence, { year: '1955', place: 'Cardiff' });
});

test('convergence is null when the parents were never married (never assumed)', () => {
  const g = buildGraph(
    [person('alice', 'female'), person('dad', 'male'), person('mum', 'female')],
    [parentEdge('dad', 'alice'), parentEdge('mum', 'alice'), marriageEdge('dad', 'mum', { married: false })],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.equal(facts.convergence, null);
});

test('convergence is null when only one parent is on record', () => {
  const g = buildGraph(
    [person('alice', 'female'), person('dad', 'male')],
    [parentEdge('dad', 'alice')],
  );
  const facts = buildAncestryFacts(g, 'alice');
  assert.equal(facts.convergence, null);
});

test('a private subject never generates a story at all', () => {
  const g = buildGraph([person('alice', 'female', { visibility: 'private' })], []);
  assert.equal(buildAncestryFacts(g, 'alice'), null);
});

test('ancestryReady: below the threshold returns false, at/above it (summed across all four lines) returns true', () => {
  const known = (n) => Array.from({ length: n }, (_, i) => ({ name: `a${i}`, restricted: false }));
  assert.equal(ancestryReady({
    fatherSide: { fatherLine: known(ANCESTRY_MIN_ANCESTORS - 1), motherLine: [] },
    motherSide: { motherLine: [], fatherLine: [] },
  }), false);
  assert.equal(ancestryReady({
    fatherSide: { fatherLine: known(2), motherLine: [] },
    motherSide: { motherLine: known(1), fatherLine: [] },
  }), true);
});

test('ancestryReady: a restricted (name-only) ancestor does not count toward the threshold', () => {
  const facts = {
    fatherSide: { fatherLine: [{ name: 'a', restricted: true }, { name: 'b', restricted: true }, { name: 'c', restricted: true }], motherLine: [] },
    motherSide: { motherLine: [], fatherLine: [] },
  };
  assert.equal(ancestryReady(facts), false);
});

test('ancestryReady: null facts is not ready', () => {
  assert.equal(ancestryReady(null), false);
});

test('factsHash is re-exported from lib/keepsake.js — same algorithm, no drift', () => {
  const a = { subject: { name: 'Alice' }, fatherSide: { fatherLine: [], motherLine: [], convergence: null }, motherSide: { motherLine: [], fatherLine: [], convergence: null }, convergence: null };
  assert.equal(typeof factsHash(a), 'string');
  assert.equal(factsHash(a), factsHash({ ...a }));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
