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
function findingsFor(id, people, rels, memoryCount = 0, documents = []) {
  const graph = buildGraph(people, rels);
  return computeEnrichment(graph.byId.get(id), graph, memoryCount, documents);
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

test('a pending document fact with a year surfaces as a document-tier finding', () => {
  const people = [{ id: 'a', display_name: 'Herbert Davies' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Service record',
    extracted: { facts: [{ year: '1942', title: 'Enlisted', detail: 'VX27390', quote: 'Enlisted 1942', tag: 'military', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  const f = findings.find((f) => f.key === 'doc_fact_doc1_0');
  assert.ok(f, 'expected a doc_fact finding');
  assert.equal(f.tier, 'document');
  assert.equal(f.icon, 'military');
  assert.equal(f.action.type, 'document-fact');
  assert.equal(f.action.docId, 'doc1');
  assert.equal(f.action.factIndex, 0);
  assert.match(f.detail, /Enlisted 1942/);
});

test('document facts without a year are withheld (no chronological slot to offer)', () => {
  const people = [{ id: 'a', display_name: 'No Year' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Letter',
    extracted: { facts: [{ year: null, title: 'Mentioned a trip', detail: null, quote: 'went away', tag: null, status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 0);
});

test('already-accepted or dismissed document facts are not re-offered', () => {
  const people = [{ id: 'a', display_name: 'Resolved' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Doc',
    extracted: { facts: [
      { year: '1945', title: 'Discharged', detail: null, quote: 'Discharged 1945', tag: 'military', status: 'accepted' },
      { year: '1946', title: 'Married', detail: null, quote: 'Married 1946', tag: null, status: 'dismissed' },
    ] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 0);
});

test('a document fact matching the derived Born year is suppressed (avoids the obvious duplicate)', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner', birth_date: '1924-11-27', birth_place: 'Mount Gambier, South Australia' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { facts: [{ year: '1924', title: 'Born', detail: "Mrs. Crafter's Nursing Home", quote: 'q', tag: null, status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 0);
});

test('a document fact matching an existing stored event (near-identical title, same year) is suppressed', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner', events: [{ year: 1945, title: 'Enlisted' }] }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Discharge certificate',
    extracted: { facts: [{ year: '1945', title: 'Enlisted/Began Service', detail: null, quote: 'q', tag: 'military', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 0);
});

test('genuinely distinct same-year document facts are still surfaced, not swept up by the duplicate guard', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner', events: [{ year: 1945, title: 'Placed dangerously ill' }] }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Medical record',
    extracted: { facts: [{ year: '1945', title: 'Surgery - Appendicectomy', detail: null, quote: 'q', tag: null, status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 1);
});

test('document facts belonging to a different person are not surfaced', () => {
  const people = [
    { id: 'a', display_name: 'This Person' },
    { id: 'b', display_name: 'Someone Else' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'b', title: 'Doc',
    extracted: { facts: [{ year: '1940', title: 'Enlisted', detail: null, quote: 'q', tag: 'military', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_fact_').length, 0);
});

test('a pending document profile field surfaces when the person field is empty', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Attestation form',
    extracted: { profileFields: { occupation: { value: 'Sawmill hand', quote: 'Sawmill hand', status: 'pending' }, birth_place: null, residence: null } },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  const f = findings.find((f) => f.key === 'doc_field_doc1_occupation');
  assert.ok(f, 'expected a doc_field finding');
  assert.equal(f.tier, 'document');
  assert.equal(f.action.type, 'document-field');
  assert.equal(f.action.docId, 'doc1');
  assert.equal(f.action.field, 'occupation');
  assert.match(f.title, /Sawmill hand/);
});

test('a document profile field is withheld once the person already has that field', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner', occupation: 'Gardener' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Attestation form',
    extracted: { profileFields: { occupation: { value: 'Sawmill hand', quote: 'q', status: 'pending' }, birth_place: null, residence: null } },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_field_').length, 0);
});

test('already-accepted or dismissed document profile fields are not re-offered', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Attestation form',
    extracted: {
      profileFields: {
        occupation: { value: 'Sawmill hand', quote: 'q', status: 'accepted' },
        birth_place: { value: 'Mount Gambier', quote: 'q', status: 'dismissed' },
        residence: null,
      },
    },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_field_').length, 0);
});

test('a document-named parent is cross-referenced to an existing person by name', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'dad', display_name: 'Robert Turner' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { peopleMentioned: [{ name: 'Robert George Turner', relation: 'parent', quote: 'Father: Robert George Turner', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  const f = findings.find((f) => f.key === 'doc_person_doc1_0');
  assert.ok(f, 'expected a doc_person finding');
  assert.equal(f.action.type, 'document-person');
  assert.equal(f.action.matchedId, 'dad');
  assert.equal(f.action.relation, 'parent');
  assert.match(f.title, /Robert Turner/);
});

test('a maiden-name aside still matches the person recorded under that surname', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'mum', display_name: 'Laura Tuffnell' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { peopleMentioned: [{ name: 'Laura Angeline Turner (formerly Tuffnell)', relation: 'parent', quote: 'Mother: Laura Angeline Turner (formerly Tuffnell)', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  const f = findings.find((f) => f.key === 'doc_person_doc1_0');
  assert.ok(f, 'expected the maiden-name aside to resolve to Laura Tuffnell');
  assert.equal(f.action.matchedId, 'mum');
});

test('a document-mentioned person with no name match in the tree is withheld', () => {
  const people = [{ id: 'a', display_name: 'Allen Turner' }];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { peopleMentioned: [{ name: 'Someone Nobody Has Added', relation: 'parent', quote: 'q', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_person_').length, 0);
});

test('a relation of "other" (a witness, registrar, attesting officer...) never surfaces, even with a name match', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'officer', display_name: 'J Stanford' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Attestation form',
    extracted: { peopleMentioned: [{ name: 'J Stanford', relation: 'other', quote: 'Attesting Officer: J Stanford', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_person_').length, 0);
});

test('a relation of "sibling" is withheld — siblings are derived, never a directly writable edge', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'sib', display_name: 'Marjorie Turner' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Letter',
    extracted: { peopleMentioned: [{ name: 'Marjorie Turner', relation: 'sibling', quote: 'q', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_person_').length, 0);
});

test('a document-named parent already recorded as the parent is not re-offered', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'dad', display_name: 'Robert Turner' },
  ];
  const rels = [parentRel('dad', 'a')];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { peopleMentioned: [{ name: 'Robert Turner', relation: 'parent', quote: 'q', status: 'pending' }] },
  }];
  const findings = findingsFor('a', people, rels, 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_person_').length, 0);
});

test('already-resolved document-mentioned people are not re-offered', () => {
  const people = [
    { id: 'a', display_name: 'Allen Turner' },
    { id: 'dad', display_name: 'Robert Turner' },
  ];
  const documents = [{
    id: 'doc1', person_id: 'a', title: 'Birth certificate',
    extracted: { peopleMentioned: [{ name: 'Robert Turner', relation: 'parent', quote: 'q', status: 'dismissed' }] },
  }];
  const findings = findingsFor('a', people, [], 0, documents);
  assert.equal(byKeyPrefix(findings, 'doc_person_').length, 0);
});

test('a marriage date on a partner relationship surfaces a Married finding', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer' },
    { id: 'b', display_name: 'Iris Mercer' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current', marriage_date: '1948-06-01', marriage_place: 'Adelaide' }];
  const findings = findingsFor('a', people, rels);
  const f = findings.find((f) => f.key === 'rel_married_b');
  assert.ok(f, 'expected a rel_married_b finding');
  assert.equal(f.tier, 'relationship');
  assert.equal(f.action.type, 'relationship-fact');
  assert.match(f.title, /Married Iris/);
  assert.match(f.title, /1948/);
  assert.match(f.detail, /Adelaide/);
});

test('a partner relationship with no marriage date raises no Married finding', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer' },
    { id: 'b', display_name: 'Iris Mercer' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' }];
  const findings = findingsFor('a', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_married_').length, 0);
});

test('a Married finding is suppressed when a near-identical event is already stored', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer', events: [{ year: 1948, title: 'Married Iris' }] },
    { id: 'b', display_name: 'Iris Mercer' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current', marriage_date: '1948-06-01' }];
  const findings = findingsFor('a', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_married_').length, 0);
});

test('a dismissed relationship fact is not re-offered', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer', dismissed_relationship_facts: ['married_b'] },
    { id: 'b', display_name: 'Iris Mercer' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current', marriage_date: '1948-06-01' }];
  const findings = findingsFor('a', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_married_').length, 0);
});

test('a still-current partner who has died surfaces a Widowed finding', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer' },
    { id: 'b', display_name: 'Iris Mercer', is_deceased: true, death_date: '1990-03-01' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' }];
  const findings = findingsFor('a', people, rels);
  const f = findings.find((f) => f.key === 'rel_widowed_b');
  assert.ok(f, 'expected a rel_widowed_b finding');
  assert.equal(f.title, 'Widowed — 1990');
  assert.match(f.detail, /Iris/);
});

test('Widowed is withheld if this person died before their partner', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer', is_deceased: true, death_date: '1985-01-01' },
    { id: 'b', display_name: 'Iris Mercer', is_deceased: true, death_date: '1990-03-01' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' }];
  const findings = findingsFor('a', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_widowed_').length, 0);
});

test('Widowed is withheld for a former (not current) partner', () => {
  const people = [
    { id: 'a', display_name: 'James Mercer' },
    { id: 'b', display_name: 'Iris Mercer', is_deceased: true, death_date: '1990-03-01' },
  ];
  const rels = [{ id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'former' }];
  const findings = findingsFor('a', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_widowed_').length, 0);
});

test('became-a-parent findings are offered per child, oldest birth first, capped at 3', () => {
  const people = [
    { id: 'p', display_name: 'Parent' },
    { id: 'c1', display_name: 'Alice', birth_date: '1950-01-01' },
    { id: 'c2', display_name: 'Bob', birth_date: '1952-01-01' },
    { id: 'c3', display_name: 'Carol', birth_date: '1954-01-01' },
    { id: 'c4', display_name: 'Dave', birth_date: '1956-01-01' },
  ];
  const rels = [parentRel('p', 'c1'), parentRel('p', 'c2'), parentRel('p', 'c3'), parentRel('p', 'c4')];
  const findings = findingsFor('p', people, rels);
  const parentFindings = byKeyPrefix(findings, 'rel_parent_');
  assert.equal(parentFindings.length, 3, 'expected the fourth child to be capped, not offered');
  assert.ok(parentFindings.some((f) => f.key === 'rel_parent_c1'));
  assert.ok(parentFindings.some((f) => f.key === 'rel_parent_c2'));
  assert.ok(parentFindings.some((f) => f.key === 'rel_parent_c3'));
  assert.ok(!parentFindings.some((f) => f.key === 'rel_parent_c4'));
});

test('became-a-parent is withheld for non-biological/adoptive children (e.g. step)', () => {
  const people = [
    { id: 'p', display_name: 'Stepparent' },
    { id: 'c', display_name: 'Stepchild', birth_date: '1990-01-01' },
  ];
  const rels = [parentRel('p', 'c', 'step')];
  const findings = findingsFor('p', people, rels);
  assert.equal(byKeyPrefix(findings, 'rel_parent_').length, 0);
});

test('became-a-grandparent surfaces once, keyed to the earliest grandchild', () => {
  const people = [
    { id: 'gp', display_name: 'Grandparent' },
    { id: 'p', display_name: 'Parent' },
    { id: 'gc1', display_name: 'Grandkid One', birth_date: '2000-01-01' },
    { id: 'gc2', display_name: 'Grandkid Two', birth_date: '2005-01-01' },
  ];
  const rels = [parentRel('gp', 'p'), parentRel('p', 'gc1'), parentRel('p', 'gc2')];
  const findings = findingsFor('gp', people, rels);
  const f = findings.find((f) => f.key === 'rel_grandparent');
  assert.ok(f, 'expected a rel_grandparent finding');
  assert.equal(f.title, 'Became a grandparent — 2000');
  assert.match(f.detail, /Grandkid One/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
