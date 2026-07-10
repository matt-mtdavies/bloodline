/**
 * Unit tests for lib/enrich.js — the deterministic "Enrich this profile"
 * engine. Focus: every finding is either a real gap, a hard contradiction, or
 * a bounded estimate — never a single guess dressed up as a fact.
 * Run with: node tests/enrich.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computeEnrichment } from '../src/lib/enrich.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

let rid = 0;
function parentRel(parentId, childId, qualifier = 'biological') {
  return { id: `r${rid++}`, type: 'parent', from_person: parentId, to_person: childId, qualifier };
}
function partnerRel(a, b, status = 'current') {
  return { id: `r${rid++}`, type: 'partner', from_person: a, to_person: b, partner_status: status };
}
function findingsFor(id, people, rels, memoryCount = 0) {
  const graph = buildGraph(people, rels);
  return computeEnrichment(graph.byId.get(id), graph, memoryCount);
}
function byKeyPrefix(findings, prefix) {
  return findings.filter((f) => f.key.startsWith(prefix));
}

test('complete profile with no gaps surfaces no completeness/timeline/estimate findings', () => {
  const people = [
    { id: 'a', display_name: 'Jane Doe', photo: 'x', bio: 'A life well lived.', birth_date: '1950-01-01', birth_place: 'Cardiff', occupation: 'Teacher', tags: ['kind'], events: [{ label: 'Moved', date: '1970-01-01' }], story: 'Already written.' },
    { id: 'b', display_name: 'John Doe', birth_date: '1948-01-01' },
  ];
  const rels = [partnerRel('a', 'b')];
  const findings = findingsFor('a', people, rels, 2);
  assert.equal(findings.find((f) => f.key === 'completeness'), undefined);
  assert.equal(findings.find((f) => f.key === 'life_story'), undefined);
  assert.equal(byKeyPrefix(findings, 'child_before_birth').length, 0);
});

test('missing fields collapse into a single "completeness" finding pointing at edit', () => {
  const people = [{ id: 'a', display_name: 'Jane Doe' }];
  const findings = findingsFor('a', people, []);
  const f = findings.find((f) => f.key === 'completeness');
  assert.ok(f, 'expected a completeness finding');
  assert.equal(f.tier, 'missing');
  assert.equal(f.action.type, 'edit');
  assert.ok(f.title.includes('%'));
});

test('duplicate pairs from findDuplicatePairs are surfaced as detected + merge action', () => {
  const people = [
    { id: 'a', display_name: 'James Davies', birth_date: '1960-01-01' },
    { id: 'b', display_name: 'James Davies', birth_date: '1960-06-01' },
    { id: 'shared', display_name: 'Shared Parent' },
  ];
  const rels = [parentRel('shared', 'a'), parentRel('shared', 'b')];
  const findings = findingsFor('a', people, rels);
  const dup = findings.find((f) => f.key === `dup_b`);
  assert.ok(dup, 'expected a dup_b finding');
  assert.equal(dup.tier, 'detected');
  assert.equal(dup.action.type, 'merge');
  assert.equal(dup.action.pair.otherId, 'b');
});

test('death before birth is flagged as a detected contradiction', () => {
  const people = [{ id: 'a', display_name: 'Old Timer', is_deceased: true, birth_date: '1950-01-01', death_date: '1940-01-01' }];
  const findings = findingsFor('a', people, []);
  const f = findings.find((f) => f.key === 'died_before_born');
  assert.ok(f);
  assert.equal(f.tier, 'detected');
  assert.equal(f.action.type, 'edit');
});

test('child born before parent is flagged, keyed to the specific child', () => {
  const people = [
    { id: 'p', display_name: 'Parent', birth_date: '1980-01-01' },
    { id: 'c', display_name: 'Child', birth_date: '1975-01-01' },
  ];
  const rels = [parentRel('p', 'c')];
  const findings = findingsFor('p', people, rels);
  const f = findings.find((f) => f.key === 'child_before_birth_c');
  assert.ok(f);
  assert.equal(f.tier, 'detected');
  assert.match(f.title, /born before/);
});

test('implausible parent age (e.g. 8 years old) is flagged distinctly from a negative age', () => {
  const people = [
    { id: 'p', display_name: 'Parent', birth_date: '1980-01-01' },
    { id: 'c', display_name: 'Child', birth_date: '1988-01-01' }, // age 8 at birth
  ];
  const rels = [parentRel('p', 'c')];
  const findings = findingsFor('p', people, rels);
  const f = findings.find((f) => f.key === 'implausible_parent_age_c');
  assert.ok(f);
  assert.equal(f.tier, 'detected');
});

test('plausible parent age (e.g. 28 years old) raises no timeline finding', () => {
  const people = [
    { id: 'p', display_name: 'Parent', birth_date: '1980-01-01' },
    { id: 'c', display_name: 'Child', birth_date: '2008-01-01' },
  ];
  const rels = [parentRel('p', 'c')];
  const findings = findingsFor('p', people, rels);
  assert.equal(byKeyPrefix(findings, 'implausible_parent_age').length, 0);
  assert.equal(byKeyPrefix(findings, 'child_before_birth').length, 0);
});

test('non-biological (step) child relationships are exempt from parent-age checks', () => {
  const people = [
    { id: 'p', display_name: 'Stepparent', birth_date: '1980-01-01' },
    { id: 'c', display_name: 'Stepchild', birth_date: '1985-01-01' }, // "age 5" if treated as bio
  ];
  const rels = [parentRel('p', 'c', 'step')];
  const findings = findingsFor('p', people, rels);
  assert.equal(byKeyPrefix(findings, 'implausible_parent_age').length, 0);
});

test('a child with only one recorded parent triggers a missing-coparent finding', () => {
  const people = [
    { id: 'p', display_name: 'Solo Parent' },
    { id: 'c', display_name: 'Kid' },
  ];
  const rels = [parentRel('p', 'c')];
  const findings = findingsFor('p', people, rels);
  const f = findings.find((f) => f.key === 'missing_coparent');
  assert.ok(f);
  assert.equal(f.tier, 'missing');
  assert.equal(f.action.type, 'add-relative');
  assert.match(f.title, /Kid/);
});

test('a child with two recorded parents raises no missing-coparent finding', () => {
  const people = [
    { id: 'p1', display_name: 'Parent One' },
    { id: 'p2', display_name: 'Parent Two' },
    { id: 'c', display_name: 'Kid' },
  ];
  const rels = [parentRel('p1', 'c'), parentRel('p2', 'c')];
  const findings = findingsFor('p1', people, rels);
  assert.equal(findings.find((f) => f.key === 'missing_coparent'), undefined);
});

test('birth-year estimate is a bounded range from relatives, not a single guess', () => {
  const people = [
    { id: 'target', display_name: 'No Birthdate' },
    { id: 'child', display_name: 'Kid', birth_date: '1970-01-01' }, // implies target born [1920, 1955]
    { id: 'parent', display_name: 'Gran', birth_date: '1900-01-01' }, // implies target born [1915, 1950]
  ];
  const rels = [parentRel('target', 'child'), parentRel('parent', 'target')];
  const findings = findingsFor('target', people, rels);
  const f = findings.find((f) => f.key === 'birth_year_estimate');
  assert.ok(f, 'expected a birth_year_estimate finding');
  assert.equal(f.tier, 'estimated');
  assert.match(f.detail, /between \d{4} and \d{4}/);
});

test('birth-year estimate is withheld when relatives give too wide or contradictory a range', () => {
  const people = [
    { id: 'target', display_name: 'No Birthdate' },
    { id: 'child', display_name: 'Kid', birth_date: '1970-01-01' }, // [1920, 1955]
    { id: 'sib', display_name: 'Sibling', birth_date: '1800-01-01' }, // [1785, 1815] — no overlap
  ];
  const rels = [parentRel('target', 'child'), parentRel('shared-parent', 'target'), parentRel('shared-parent', 'sib')];
  people.push({ id: 'shared-parent', display_name: 'Shared Parent' });
  const findings = findingsFor('target', people, rels);
  assert.equal(findings.find((f) => f.key === 'birth_year_estimate'), undefined);
});

test('no birth-year estimate is offered when no relative has a usable date', () => {
  const people = [
    { id: 'target', display_name: 'No Birthdate' },
    { id: 'child', display_name: 'Kid' }, // no birth_date either — nothing to estimate from
  ];
  const rels = [parentRel('target', 'child')];
  const findings = findingsFor('target', people, rels);
  assert.equal(findings.find((f) => f.key === 'birth_year_estimate'), undefined);
});

test('life-story pointer appears once there is material and no story yet', () => {
  const people = [{ id: 'a', display_name: 'Jane Doe', birth_date: '1950-01-01' }];
  const findings = findingsFor('a', people, []);
  const f = findings.find((f) => f.key === 'life_story');
  assert.ok(f);
  assert.equal(f.tier, 'story');
  assert.equal(f.action.type, 'story');
});

test('life-story pointer is withheld with no material at all', () => {
  const people = [{ id: 'a', display_name: 'Blank Slate' }];
  const findings = findingsFor('a', people, []);
  assert.equal(findings.find((f) => f.key === 'life_story'), undefined);
});

test('life-story pointer is withheld once a story already exists', () => {
  const people = [{ id: 'a', display_name: 'Jane Doe', birth_date: '1950-01-01', story: 'Already written.' }];
  const findings = findingsFor('a', people, []);
  assert.equal(findings.find((f) => f.key === 'life_story'), undefined);
});

test('a null person returns no findings rather than throwing', () => {
  const graph = buildGraph([], []);
  assert.deepEqual(computeEnrichment(null, graph, 0), []);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
