/**
 * Unit tests for src/lib/integrity.js — data-integrity checks (concurrent
 * partners, implausible ages, birth/death/parentage date-ordering, and
 * ancestor cycles). Each check gets a qualifying case and a just-below-
 * threshold/non-qualifying case, matching this project's existing test
 * convention (see tests/insightModules.test.mjs, tests/duplicates.test.mjs).
 * Run with: node tests/integrity.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import {
  computeIntegrityIssues, findConcurrentPartners, findImplausibleAges, findLikelyDeceased,
  findDeathBeforeBirth, findParentChildTimingIssues, findMarriageOutsideLifespan,
  findAncestorCycles, issueKey,
} from '../src/lib/integrity.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const p = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });
const parentEdge = (from, to, qualifier) => ({ id: `pe_${from}_${to}`, type: 'parent', from_person: from, to_person: to, qualifier });
const partnerEdge = (a, b, extra = {}) => ({ id: `xe_${a}_${b}`, type: 'partner', from_person: a, to_person: b, partner_status: 'current', ...extra });

// ── findConcurrentPartners ──────────────────────────────────────────────────

test('flags a person with two simultaneous current partners', () => {
  const people = [p('a'), p('b'), p('c')];
  const rels = [partnerEdge('a', 'b'), partnerEdge('a', 'c')];
  const g = buildGraph(people, rels);
  const issues = findConcurrentPartners(g);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'concurrent_partners');
  assert.deepEqual(new Set(issues[0].personIds), new Set(['a', 'b', 'c']));
});

test('does NOT flag one current + one former partner', () => {
  const people = [p('a'), p('b'), p('c')];
  const rels = [partnerEdge('a', 'b'), partnerEdge('a', 'c', { partner_status: 'former' })];
  const g = buildGraph(people, rels);
  assert.equal(findConcurrentPartners(g).length, 0);
});

test('does NOT flag a single current partner', () => {
  const people = [p('a'), p('b')];
  const g = buildGraph(people, [partnerEdge('a', 'b')]);
  assert.equal(findConcurrentPartners(g).length, 0);
});

// ── findImplausibleAges ──────────────────────────────────────────────────────

test('flags a deceased person over the plausible-age ceiling', () => {
  const g = buildGraph([p('a', { birth_date: '1850-01-01', is_deceased: true, death_date: '1990-01-01' })], []);
  const issues = findImplausibleAges(g, new Date('2026-01-01').getTime());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'implausible_age');
});

test('does NOT flag a plausible 100-year-old (just under the ceiling)', () => {
  const g = buildGraph([p('a', { birth_date: '1926-06-01' })], []);
  assert.equal(findImplausibleAges(g, new Date('2026-01-01').getTime()).length, 0);
});

test('does NOT flag a deceased person with no death date (can\'t evaluate — silence over a guess)', () => {
  const g = buildGraph([p('a', { birth_date: '1850-01-01', is_deceased: true, death_date: null })], []);
  assert.equal(findImplausibleAges(g, new Date('2026-01-01').getTime()).length, 0);
});

test('does NOT flag a living person over the ceiling (that\'s findLikelyDeceased\'s job, not this check\'s)', () => {
  const g = buildGraph([p('a', { birth_date: '1900-01-01' })], []);
  assert.equal(findImplausibleAges(g, new Date('2026-01-01').getTime()).length, 0);
});

// ── findLikelyDeceased ────────────────────────────────────────────────────────

test('flags a living person who would be over the plausible-age ceiling today', () => {
  const g = buildGraph([p('a', { birth_date: '1900-01-01' })], []);
  const issues = findLikelyDeceased(g, new Date('2026-01-01').getTime());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'likely_deceased');
  assert.deepEqual(issues[0].personIds, ['a']);
  assert.match(issues[0].reason, /likely passed away/);
});

test('does NOT flag a living person just under the ceiling', () => {
  const g = buildGraph([p('a', { birth_date: '1926-06-01' })], []);
  assert.equal(findLikelyDeceased(g, new Date('2026-01-01').getTime()).length, 0);
});

test('does NOT flag someone already marked deceased (that\'s findImplausibleAges\' job, not this check\'s)', () => {
  const g = buildGraph([p('a', { birth_date: '1850-01-01', is_deceased: true, death_date: '1990-01-01' })], []);
  assert.equal(findLikelyDeceased(g, new Date('2026-01-01').getTime()).length, 0);
});

test('does NOT flag a living person with no birth date (can\'t evaluate — silence over a guess)', () => {
  const g = buildGraph([p('a', { birth_date: null })], []);
  assert.equal(findLikelyDeceased(g, new Date('2026-01-01').getTime()).length, 0);
});

// ── findDeathBeforeBirth ─────────────────────────────────────────────────────

test('flags a death date recorded before the birth date', () => {
  const g = buildGraph([p('a', { birth_date: '2000-01-01', is_deceased: true, death_date: '1999-01-01' })], []);
  const issues = findDeathBeforeBirth(g);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'death_before_birth');
});

test('does NOT flag a normal birth-then-death ordering', () => {
  const g = buildGraph([p('a', { birth_date: '1950-01-01', is_deceased: true, death_date: '2020-01-01' })], []);
  assert.equal(findDeathBeforeBirth(g).length, 0);
});

test('does NOT flag a same-day birth and death (span 0, a real tragic case, not an error)', () => {
  const g = buildGraph([p('a', { birth_date: '1950-01-01', is_deceased: true, death_date: '1950-01-01' })], []);
  assert.equal(findDeathBeforeBirth(g).length, 0);
});

// ── findParentChildTimingIssues ──────────────────────────────────────────────

test('flags a child recorded as born before their parent', () => {
  const people = [p('parent', { birth_date: '1980-01-01' }), p('child', { birth_date: '1970-01-01' })];
  const g = buildGraph(people, [parentEdge('parent', 'child')]);
  const issues = findParentChildTimingIssues(g);
  assert.ok(issues.some((i) => i.type === 'child_before_parent'));
});

test('flags a child born more than a year after a parent\'s death', () => {
  const people = [
    p('parent', { birth_date: '1950-01-01', is_deceased: true, death_date: '1990-01-01' }),
    p('child', { birth_date: '1993-01-01' }),
  ];
  const g = buildGraph(people, [parentEdge('parent', 'child')]);
  const issues = findParentChildTimingIssues(g);
  assert.ok(issues.some((i) => i.type === 'child_after_parent_death'));
});

test('does NOT flag a posthumous birth within the grace window', () => {
  const people = [
    p('parent', { birth_date: '1950-01-01', is_deceased: true, death_date: '1990-06-01' }),
    p('child', { birth_date: '1991-01-01' }),
  ];
  const g = buildGraph(people, [parentEdge('parent', 'child')]);
  const issues = findParentChildTimingIssues(g);
  assert.ok(!issues.some((i) => i.type === 'child_after_parent_death'));
});

test('flags a biological parent under the minimum plausible age at the child\'s birth', () => {
  const people = [p('parent', { birth_date: '1990-01-01' }), p('child', { birth_date: '1995-01-01' })];
  const g = buildGraph(people, [parentEdge('parent', 'child', 'biological')]);
  const issues = findParentChildTimingIssues(g);
  assert.ok(issues.some((i) => i.type === 'parent_too_young'));
});

test('does NOT flag a step-parent under the minimum age (no biological timing constraint)', () => {
  const people = [p('parent', { birth_date: '1990-01-01' }), p('child', { birth_date: '1995-01-01' })];
  const g = buildGraph(people, [parentEdge('parent', 'child', 'step')]);
  const issues = findParentChildTimingIssues(g);
  assert.ok(!issues.some((i) => i.type === 'parent_too_young'));
});

test('does NOT flag an ordinary, plausible parent-child pair', () => {
  const people = [p('parent', { birth_date: '1960-01-01' }), p('child', { birth_date: '1990-01-01' })];
  const g = buildGraph(people, [parentEdge('parent', 'child', 'biological')]);
  assert.equal(findParentChildTimingIssues(g).length, 0);
});

// ── findMarriageOutsideLifespan ──────────────────────────────────────────────

test('flags a marriage date before one partner was born', () => {
  const people = [p('a', { birth_date: '1990-01-01' }), p('b', { birth_date: '1960-01-01' })];
  const g = buildGraph(people, [partnerEdge('a', 'b', { marriage_date: '1985-01-01' })]);
  const issues = findMarriageOutsideLifespan(g);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'marriage_outside_lifespan');
});

test('flags a marriage date after one partner had already died', () => {
  const people = [
    p('a', { birth_date: '1960-01-01' }),
    p('b', { birth_date: '1960-01-01', is_deceased: true, death_date: '2000-01-01' }),
  ];
  const g = buildGraph(people, [partnerEdge('a', 'b', { marriage_date: '2005-01-01' })]);
  const issues = findMarriageOutsideLifespan(g);
  assert.equal(issues.length, 1);
});

test('does NOT flag a marriage date within both partners\' lifespans', () => {
  const people = [p('a', { birth_date: '1960-01-01' }), p('b', { birth_date: '1962-01-01' })];
  const g = buildGraph(people, [partnerEdge('a', 'b', { marriage_date: '1985-01-01' })]);
  assert.equal(findMarriageOutsideLifespan(g).length, 0);
});

test('does NOT flag a partner edge with no marriage date recorded', () => {
  const people = [p('a', { birth_date: '1960-01-01' }), p('b', { birth_date: '1962-01-01' })];
  const g = buildGraph(people, [partnerEdge('a', 'b')]);
  assert.equal(findMarriageOutsideLifespan(g).length, 0);
});

// ── findAncestorCycles ────────────────────────────────────────────────────────

test('flags a direct two-hop ancestor cycle (a is their own grandparent)', () => {
  const people = [p('a'), p('b')];
  // a -> parent of -> b -> parent of -> a  (a walking up from itself finds itself)
  const g = buildGraph(people, [parentEdge('a', 'b'), parentEdge('b', 'a')]);
  const issues = findAncestorCycles(g);
  assert.ok(issues.some((i) => i.type === 'ancestor_cycle' && i.personIds.includes('a')));
});

test('does NOT flag a normal, acyclic ancestor chain', () => {
  const people = [p('grandparent'), p('parent'), p('child')];
  const g = buildGraph(people, [parentEdge('grandparent', 'parent'), parentEdge('parent', 'child')]);
  assert.equal(findAncestorCycles(g).length, 0);
});

test('does NOT flag someone with no parents at all', () => {
  const g = buildGraph([p('a')], []);
  assert.equal(findAncestorCycles(g).length, 0);
});

// ── issueKey ──────────────────────────────────────────────────────────────────

test('issueKey is stable regardless of personIds order', () => {
  assert.equal(issueKey('concurrent_partners', ['a', 'b', 'c']), issueKey('concurrent_partners', ['c', 'a', 'b']));
});

test('issueKey differs by type even with identical personIds', () => {
  assert.notEqual(issueKey('death_before_birth', ['a']), issueKey('implausible_age', ['a']));
});

// ── computeIntegrityIssues: the aggregate ────────────────────────────────────

test('computeIntegrityIssues aggregates every check', () => {
  const people = [
    p('a', { birth_date: '1990-01-01' }), p('b', { birth_date: '1960-01-01' }), p('c'),
    p('d', { birth_date: '1900-01-01' }), // over the ceiling, still living
  ];
  const rels = [partnerEdge('a', 'b'), partnerEdge('a', 'c')]; // concurrent partners for a
  const g = buildGraph(people, rels);
  const issues = computeIntegrityIssues(g, new Date('2026-01-01').getTime());
  assert.ok(issues.some((i) => i.type === 'concurrent_partners'));
  assert.ok(issues.some((i) => i.type === 'likely_deceased'));
});

test('a completely clean tree produces zero issues', () => {
  const people = [
    p('grandparent', { birth_date: '1930-01-01', is_deceased: true, death_date: '2005-01-01' }),
    p('parent', { birth_date: '1960-01-01' }),
    p('child', { birth_date: '1990-01-01' }),
    p('partner', { birth_date: '1962-01-01' }),
  ];
  const rels = [
    parentEdge('grandparent', 'parent', 'biological'),
    parentEdge('parent', 'child', 'biological'),
    partnerEdge('parent', 'partner', { marriage_date: '1988-01-01' }),
  ];
  const g = buildGraph(people, rels);
  assert.equal(computeIntegrityIssues(g, new Date('2026-01-01').getTime()).length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
