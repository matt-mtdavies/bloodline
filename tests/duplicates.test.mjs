/**
 * Regression test for the nameKey suffix bug found reviewing the import
 * pipeline: nameKey() took the LAST whitespace token as the surname, so
 * "John Smith Jr." keyed as first="john" last="jr." — which never grouped
 * with a duplicate stub "John Smith" (last="smith"), silently missing a
 * real duplicate pair. Generational suffixes (Jr./Sr./II/III/IV/V) are now
 * stripped before the surname is taken.
 *
 * Run with: node tests/duplicates.test.mjs
 */
import assert from 'node:assert/strict';
import { findDuplicatePairs, dedupeMergeImport, mergePersonFields, describeMergeChanges, summarizeMergeImport, findLikelyExistingMatches } from '../src/lib/duplicates.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('a "Jr." suffix no longer prevents matching a same-named stub', () => {
  const people = [
    { id: 'a', display_name: 'John Smith Jr.' },
    { id: 'b', display_name: 'John Smith' }, // a thin stub — no birth_date/photo/bio/events
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1, 'the suffix should not block the stub-record duplicate signal');
  assert.deepEqual([pairs[0].aId, pairs[0].bId].sort(), ['a', 'b']);
});

test('"II"/"III" suffixes are stripped the same way', () => {
  const people = [
    { id: 'a', display_name: 'Robert Doyle III' },
    { id: 'b', display_name: 'Robert Doyle' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1);
});

test('two genuinely different people who happen to share a first+last name are still not falsely matched (no corroboration)', () => {
  const people = [
    { id: 'a', display_name: 'John Smith', birth_date: '1950', bio: 'A long biography.' },
    { id: 'b', display_name: 'John Smith', birth_date: '1990', bio: 'A different long biography.' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 0, 'conflicting known birth years should still rule the pair out');
});

// ── conflicting known relatives rule a pair out (real report, with a
// screenshot: a thin dateless stub was flagged against two completely
// different, fully-documented same-named people 71 years apart) ───────────

test('a thin stub is NOT flagged against a same-named person with a different recorded parent (the reported bug)', () => {
  const people = [
    { id: 'george', display_name: 'George Ransom' },
    { id: 'dorothy', display_name: 'Dorothy Ransom' },
    { id: 'john', display_name: 'John Ransom' },
    { id: 'margaret', display_name: 'Margaret Ransom' },
    { id: 'stub', display_name: 'James Ransom' }, // thin — no birth_date/photo/bio/events
    { id: 'real', display_name: 'James Ransom', birth_date: '1835-09-25' },
  ];
  const relationships = [
    { type: 'parent', from_person: 'george', to_person: 'stub' },
    { type: 'parent', from_person: 'dorothy', to_person: 'stub' },
    { type: 'parent', from_person: 'john', to_person: 'real' },
    { type: 'parent', from_person: 'margaret', to_person: 'real' },
  ];
  const pairs = findDuplicatePairs(people, relationships);
  assert.equal(
    pairs.filter((p) => [p.aId, p.bId].sort().join('~') === ['stub', 'real'].sort().join('~')).length,
    0,
    'conflicting known parents (George/Dorothy vs John/Margaret) should rule the pair out, even though the stub alone would otherwise corroborate it',
  );
});

test('a thin stub IS still flagged against a same-named person when nothing recorded actually conflicts', () => {
  const people = [
    { id: 'stub', display_name: 'James Ransom' },
    { id: 'real', display_name: 'James Ransom', birth_date: '1835-09-25' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1, 'the stub signal itself is still valid when there is no conflicting evidence to override it');
});

test('conflicting known children rule a pair out', () => {
  const people = [
    { id: 'a', display_name: 'James Ransom', birth_date: '1835' },
    { id: 'b', display_name: 'James Ransom', birth_date: '1835' },
    { id: 'rose', display_name: 'Rose Ransom' },
    { id: 'sarah', display_name: 'Sarah Ransom' },
  ];
  const relationships = [
    { type: 'parent', from_person: 'a', to_person: 'rose' },
    { type: 'parent', from_person: 'b', to_person: 'sarah' },
  ];
  const pairs = findDuplicatePairs(people, relationships);
  assert.equal(pairs.length, 0, 'different recorded children (Rose vs Sarah) rule the pair out even with a matching birth year');
});

test('conflicting known partners rule a pair out', () => {
  const people = [
    { id: 'a', display_name: 'James Ransom', birth_date: '1835' },
    { id: 'b', display_name: 'James Ransom', birth_date: '1835' },
    { id: 'sarah', display_name: 'Sarah Ransom' },
    { id: 'mariah', display_name: 'Mariah Ransom' },
  ];
  const relationships = [
    { type: 'partner', from_person: 'a', to_person: 'sarah' },
    { type: 'partner', from_person: 'b', to_person: 'mariah' },
  ];
  const pairs = findDuplicatePairs(people, relationships);
  assert.equal(pairs.length, 0, 'different recorded partners (Sarah vs Mariah) rule the pair out');
});

test('a genuinely SHARED parent (same person, not just same name) still corroborates normally', () => {
  const people = [
    { id: 'george', display_name: 'George Ransom' },
    { id: 'a', display_name: 'James Ransom' },
    { id: 'b', display_name: 'James Ransom', birth_date: '1835' },
  ];
  const relationships = [
    { type: 'parent', from_person: 'george', to_person: 'a' },
    { type: 'parent', from_person: 'george', to_person: 'b' },
  ];
  const pairs = findDuplicatePairs(people, relationships);
  assert.equal(pairs.length, 1, 'sharing the same actual parent record is positive evidence, not a conflict');
  assert.ok(pairs[0].reasons.some((r) => r.includes('shared parent')));
});

test('a one-sided known parent (the other side has none recorded) does not count as a conflict', () => {
  const people = [
    { id: 'john', display_name: 'John Ransom' },
    { id: 'a', display_name: 'James Ransom' }, // no recorded parent at all
    { id: 'b', display_name: 'James Ransom', birth_date: '1835' },
  ];
  const relationships = [
    { type: 'parent', from_person: 'john', to_person: 'b' },
  ];
  const pairs = findDuplicatePairs(people, relationships);
  assert.equal(pairs.length, 1, 'no conflict when one side simply has no recorded parent to compare — only an ACTUAL mismatch rules a pair out');
});

test('a bare two-word name is unaffected by the suffix-stripping change', () => {
  const people = [
    { id: 'a', display_name: 'Jane Doe' },
    { id: 'b', display_name: 'Jane Doe' },
  ];
  const pairs = findDuplicatePairs(people, []);
  assert.equal(pairs.length, 1, 'the ordinary two-word case must still match exactly as before');
});

// ── dedupeMergeImport: re-importing shouldn't double the tree ───────────────

test('re-importing the same people collapses them (no doubling), remapping edges', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12' },
    { id: 'e2', display_name: 'Mary Smith', birth_date: '1952' },
    { id: 'e3', display_name: 'Anne Smith', birth_date: '1978' },
  ];
  const existingR = [
    { id: 'er1', type: 'partner', from_person: 'e1', to_person: 'e2' },
    { id: 'er2', type: 'parent', from_person: 'e1', to_person: 'e3' },
  ];
  // The same three people + same edges, freshly parsed with new ids.
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950-03-12' },
    { id: 'n2', display_name: 'Mary Smith', birth_date: '1952' },
    { id: 'n3', display_name: 'Anne Smith', birth_date: '1978' },
  ];
  const newR = [
    { id: 'nr1', type: 'partner', from_person: 'n1', to_person: 'n2' },
    { id: 'nr2', type: 'parent', from_person: 'n1', to_person: 'n3' },
  ];
  const out = dedupeMergeImport(existingP, existingR, newP, newR);
  assert.equal(out.people.length, 0, 'every re-added person is collapsed');
  assert.equal(out.skipped, 3);
  assert.equal(out.relationships.length, 0, 'edges that map onto existing ones are dropped too');
});

test('genuinely new people (and their edges) still import', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950' },     // dup → collapsed
    { id: 'n2', display_name: 'Baby Smith', birth_date: '2020' },     // new → kept
  ];
  const newR = [{ id: 'nr1', type: 'parent', from_person: 'n1', to_person: 'n2' }];
  const out = dedupeMergeImport(existingP, [], newP, newR);
  assert.deepEqual(out.people.map((p) => p.id), ['n2']);
  assert.equal(out.relationships.length, 1, 'the new parent edge survives...');
  assert.equal(out.relationships[0].from_person, 'e1', '...remapped onto the existing John');
  assert.equal(out.relationships[0].to_person, 'n2');
});

test('an ambiguous match (two existing people, same name+year) is NOT auto-merged', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950' },
    { id: 'e2', display_name: 'John Smith', birth_date: '1950' }, // already two (cousins?)
  ];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1'], 'ambiguity falls through to the review sheet, not a silent merge');
});

test('a full-date conflict (same name+year, different day) is kept separate', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12' }];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950-11-30' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1'], 'conflicting exact dates → different people');
});

test('a dateless record is never auto-merged (too weak — left for review)', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith' }];
  const newP = [{ id: 'n1', display_name: 'John Smith' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.deepEqual(out.people.map((p) => p.id), ['n1']);
});

// ── mergePersonFields: array-field dedup (delta re-import safety) ──────────
// Blind concatenation was fine for a one-off duplicate-person merge, but a
// repeatable "re-import an updated export" workflow calls this again on
// every re-import — without dedup, unchanged residence/education/military/
// event/condition entries would double (then triple, ...) each time the
// same source data was re-imported.

test('mergePersonFields dedupes identical residences instead of doubling them', () => {
  const keep = { residences: [{ id: 'r1', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const drop = { residences: [{ id: 'r2', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.residences.length, 1, 'the identical re-imported residence is not duplicated');
});

test('mergePersonFields keeps two residences at the same place with different years', () => {
  const keep = { residences: [{ id: 'r1', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const drop = { residences: [{ id: 'r2', place: 'Cardiff, Wales', from_year: 1990, to_year: 1995 }] };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.residences.length, 2, 'genuinely distinct stays at the same place are both kept');
});

test('mergePersonFields dedupes identical education, military medals, events, and conditions', () => {
  const keep = {
    education: [{ id: 'e1', institution: 'Cardiff University', from_year: 1988, to_year: 1991 }],
    military_medals: [{ name: 'Victory Medal', detail: 'WWI' }],
    events: [{ year: 1918, title: 'Military service', tag: 'military', detail: 'Fort Slocum, New York' }],
    conditions: [{ id: 'c1', name: 'Diabetes', category: 'chronic', status: 'active', onset_year: 1960 }],
  };
  const drop = {
    education: [{ id: 'e2', institution: 'Cardiff University', from_year: 1988, to_year: 1991 }],
    military_medals: [{ name: 'Victory Medal', detail: 'WWI' }],
    events: [{ year: 1918, title: 'Military service', tag: 'military', detail: 'Fort Slocum, New York' }],
    conditions: [{ id: 'c2', name: 'Diabetes', category: 'chronic', status: 'active', onset_year: 1960 }],
  };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.education.length, 1);
  assert.equal(merged.military_medals.length, 1);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.conditions.length, 1);
});

test('mergePersonFields fills a blank resting_place from the dropped record', () => {
  const keep = { resting_place: null };
  const drop = { resting_place: { cemetery: null, plot: null, place: 'Mount Royal, Montreal, Quebec, Canada', suburb: null, state: null, country: null, lat: null, lon: null } };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.resting_place.place, 'Mount Royal, Montreal, Quebec, Canada');
});

test('mergePersonFields never overwrites an existing resting_place', () => {
  const keep = { resting_place: { cemetery: null, plot: null, place: 'Victor, New York', suburb: null, state: null, country: null, lat: null, lon: null } };
  const drop = { resting_place: { cemetery: null, plot: null, place: 'Somewhere else', suburb: null, state: null, country: null, lat: null, lon: null } };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.resting_place.place, 'Victor, New York');
});

test('mergePersonFields still concatenates genuinely distinct array entries (no over-dedup)', () => {
  const keep = { residences: [{ id: 'r1', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const drop = { residences: [{ id: 'r2', place: 'Fremantle, Australia', from_year: 1988, to_year: 2001 }] };
  const merged = mergePersonFields(keep, drop);
  assert.equal(merged.residences.length, 2);
});

test('re-running mergePersonFields on its own output a second time is a no-op (idempotent re-import)', () => {
  const keep = { residences: [{ id: 'r1', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const drop = { residences: [{ id: 'r2', place: 'Cardiff, Wales', from_year: 1970, to_year: 1980 }] };
  const once = mergePersonFields(keep, drop);
  const twice = mergePersonFields(once, drop);
  assert.equal(twice.residences.length, 1, 'importing the same snapshot again does not grow the array further');
});

test('a collapsed re-add carries its field data onto the surviving existing person', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12', residences: [] },
  ];
  const newP = [
    {
      id: 'n1',
      display_name: 'John Smith',
      birth_date: '1950-03-12',
      residences: [{ place: 'Cardiff', from_year: '1970' }],
      education: [{ stage: 'university', institution: 'Cardiff University' }],
      military_branch: 'Army',
      military_medals: [{ name: 'Victory Medal' }],
    },
  ];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.equal(out.people.length, 0, 'the re-add is still collapsed, not kept as a new person');
  assert.ok(out.updatedExisting, 'returns an updatedExisting map');
  const merged = out.updatedExisting.get('e1');
  assert.ok(merged, 'e1 has an updated record');
  assert.equal(merged.residences.length, 1, 'residences carried over from the collapsed re-add');
  assert.equal(merged.education.length, 1, 'education carried over from the collapsed re-add');
  assert.equal(merged.military_branch, 'Army', 'a blank scalar field is filled from the re-add');
  assert.equal(merged.military_medals.length, 1, 'medals carried over from the collapsed re-add');
});

test('an existing person\'s own field values are never overwritten by a collapsed re-add', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950-03-12', occupation: 'Carpenter' },
  ];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950-03-12', occupation: 'Farmer' },
  ];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.equal(out.updatedExisting.get('e1').occupation, 'Carpenter', 'existing scalar wins over the re-add on conflict');
});

test('genuinely new (non-colliding) people never appear in updatedExisting', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [{ id: 'n1', display_name: 'Baby Smith', birth_date: '2020' }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  assert.equal(out.updatedExisting.size, 0);
});

// ── describeMergeChanges / summarizeMergeImport (delta-import review) ──────

test('describeMergeChanges reports each newly-filled scalar field', () => {
  const before = { display_name: 'Ann Lee' };
  const after = { display_name: 'Ann Lee', birth_place: 'Cardiff, Wales', occupation: 'Nurse' };
  const changes = describeMergeChanges(before, after);
  assert.ok(changes.includes('birth place added'));
  assert.ok(changes.includes('occupation added'));
});

test('describeMergeChanges reports a newly-filled resting_place as "burial place added"', () => {
  const before = { resting_place: null };
  const after = { resting_place: { place: 'Mount Royal, Montreal, Quebec, Canada' } };
  assert.deepEqual(describeMergeChanges(before, after), ['burial place added']);
});

test('describeMergeChanges reports growth in array fields with a count', () => {
  const before = { residences: [{ place: 'Cardiff, Wales' }] };
  const after = { residences: [{ place: 'Cardiff, Wales' }, { place: 'Fremantle, Australia' }, { place: 'London, England' }] };
  assert.deepEqual(describeMergeChanges(before, after), ['+2 places lived']);
});

test('describeMergeChanges reports nothing when nothing actually changed', () => {
  const person = { display_name: 'Ann Lee', birth_place: 'Cardiff, Wales', residences: [{ place: 'Cardiff, Wales' }] };
  assert.deepEqual(describeMergeChanges(person, { ...person }), []);
});

test('describeMergeChanges never reports a field that was already filled, even if the incoming value differs', () => {
  const before = { occupation: 'Carpenter' };
  const after = { occupation: 'Carpenter' }; // mergePersonFields never overwrites — after always equals before here
  assert.deepEqual(describeMergeChanges(before, after), []);
});

// Real report: a military-tagged event added via a GEDCOM's _MILT tag was
// indistinguishable from any other life event in the summary ("I don't see
// any military additions" when there actually were some).
test('describeMergeChanges reports a newly-added military-tagged event as "military record", not "life event"', () => {
  const before = { events: [] };
  const after = { events: [{ year: 1918, title: 'Military service', tag: 'military', detail: 'Fort Slocum, New York' }] };
  assert.deepEqual(describeMergeChanges(before, after), ['+1 military record']);
});

test('describeMergeChanges keeps a non-military new event as "life event"', () => {
  const before = { events: [] };
  const after = { events: [{ year: 2007, title: 'Graduated' }] };
  assert.deepEqual(describeMergeChanges(before, after), ['+1 life event']);
});

test('describeMergeChanges reports military and non-military new events as separate lines, correctly pluralized', () => {
  const before = { events: [{ year: 2000, title: 'Existing event' }] };
  const after = {
    events: [
      { year: 2000, title: 'Existing event' },
      { year: 1917, title: 'Military service', tag: 'military' },
      { year: 1918, title: 'Military service', tag: 'military' },
      { year: 2010, title: 'Moved house' },
    ],
  };
  const changes = describeMergeChanges(before, after);
  assert.ok(changes.includes('+2 military records'));
  assert.ok(changes.includes('+1 life event'));
});

test('summarizeMergeImport buckets new people, enriched people, and true no-ops separately', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950', residences: [] }, // will be enriched
    { id: 'e2', display_name: 'Mary Smith', birth_date: '1952', occupation: 'Teacher' }, // true no-op re-add
  ];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950', residences: [{ place: 'Cardiff, Wales' }] },
    { id: 'n2', display_name: 'Mary Smith', birth_date: '1952', occupation: 'Teacher' }, // identical — nothing new
    { id: 'n3', display_name: 'Baby Smith', birth_date: '2020' }, // genuinely new
  ];
  const summary = summarizeMergeImport(existingP, [], newP, []);
  assert.equal(summary.newPeople.length, 1, 'exactly one genuinely new person');
  assert.equal(summary.newPeople[0].id, 'n3');
  assert.equal(summary.enrichedPeople.length, 1, 'exactly one existing person gained something');
  assert.equal(summary.enrichedPeople[0].id, 'e1');
  assert.deepEqual(summary.enrichedPeople[0].changes, ['+1 place lived']);
  assert.equal(summary.unchangedCount, 1, 'the identical Mary Smith re-add is a true no-op, not "enriched"');
});

test('summarizeMergeImport on a literal re-import of the same file reports zero new, zero enriched', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950', occupation: 'Carpenter' }];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950', occupation: 'Carpenter' }];
  const summary = summarizeMergeImport(existingP, [], newP, []);
  assert.equal(summary.newPeople.length, 0);
  assert.equal(summary.enrichedPeople.length, 0);
  assert.equal(summary.unchangedCount, 1);
});

// ── dedupeMergeImport: selective apply (skipPeople / skipEnrichmentFor) ────
// Real user follow-up on a large re-import: "I don't necessarily want to
// add all new people, and maybe I only want the diffs to existing people,
// or maybe I only want diffs for a few selected people."

test('skipPeople fully excludes a genuinely new person — not added, not merged', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950' },  // dup → collapsed as usual
    { id: 'n2', display_name: 'Baby Smith', birth_date: '2020' },  // new, but excluded
    { id: 'n3', display_name: 'Other Smith', birth_date: '2021' }, // new, kept
  ];
  const out = dedupeMergeImport(existingP, [], newP, [], { skipPeople: new Set(['n2']) });
  assert.deepEqual(out.people.map((p) => p.id), ['n3'], 'n2 is excluded, n3 still imports normally');
});

test('skipPeople drops relationships that would have referenced the excluded person', () => {
  const existingP = [{ id: 'e1', display_name: 'Parent One', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'Baby Smith', birth_date: '2020' }, // excluded
    { id: 'n2', display_name: 'Other Smith', birth_date: '2021' },
  ];
  const newR = [
    { id: 'r1', type: 'parent', from_person: 'e1', to_person: 'n1' }, // references the excluded person
    { id: 'r2', type: 'parent', from_person: 'e1', to_person: 'n2' },
  ];
  const out = dedupeMergeImport(existingP, [], newP, newR, { skipPeople: new Set(['n1']) });
  assert.equal(out.relationships.length, 1, 'the edge to the excluded person is dropped, the other survives');
  assert.equal(out.relationships[0].to_person, 'n2');
});

test('skipPeople does not affect the skipped count (that still means "collapsed as duplicate")', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950' }, // collapses
    { id: 'n2', display_name: 'Baby Smith', birth_date: '2020' }, // excluded by choice, not a duplicate
  ];
  const out = dedupeMergeImport(existingP, [], newP, [], { skipPeople: new Set(['n2']) });
  assert.equal(out.skipped, 1, 'only the real collapse counts as "skipped" (duplicate), not the opted-out person');
  assert.equal(out.people.length, 0);
});

test('skipEnrichmentFor still collapses the duplicate (no doubling) but writes no new facts', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950', occupation: null, residences: [] }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950', occupation: 'Carpenter', residences: [{ place: 'Cardiff' }] },
  ];
  const out = dedupeMergeImport(existingP, [], newP, [], { skipEnrichmentFor: new Set(['e1']) });
  assert.equal(out.people.length, 0, 'still collapsed — no duplicate person created');
  assert.equal(out.updatedExisting.size, 0, 'but nothing was merged onto e1');
});

test('skipEnrichmentFor still remaps relationships onto the existing survivor', () => {
  const existingP = [
    { id: 'e1', display_name: 'John Smith', birth_date: '1950' },
    { id: 'e2', display_name: 'Existing Child', birth_date: '1975' },
  ];
  const newP = [{ id: 'n1', display_name: 'John Smith', birth_date: '1950', occupation: 'Carpenter' }];
  const newR = [{ id: 'r1', type: 'parent', from_person: 'n1', to_person: 'e2' }];
  const out = dedupeMergeImport(existingP, [], newP, newR, { skipEnrichmentFor: new Set(['e1']) });
  assert.equal(out.relationships.length, 1, 'the edge still resolves through the collapse');
  assert.equal(out.relationships[0].from_person, 'e1', 'remapped onto the survivor exactly as without the opt');
  assert.equal(out.updatedExisting.size, 0, 'still no field data written to e1');
});

test('skipPeople and skipEnrichmentFor can be used together, independently', () => {
  const existingP = [{ id: 'e1', display_name: 'John Smith', birth_date: '1950' }];
  const newP = [
    { id: 'n1', display_name: 'John Smith', birth_date: '1950', occupation: 'Carpenter' }, // collapses, enrichment skipped
    { id: 'n2', display_name: 'Baby Smith', birth_date: '2020' }, // fully excluded
    { id: 'n3', display_name: 'Other Smith', birth_date: '2021' }, // imports normally
  ];
  const out = dedupeMergeImport(existingP, [], newP, [], { skipPeople: new Set(['n2']), skipEnrichmentFor: new Set(['e1']) });
  assert.deepEqual(out.people.map((p) => p.id), ['n3']);
  assert.equal(out.updatedExisting.size, 0);
});

// ── findLikelyExistingMatches (dateless "new" people who likely already
// exist) ─────────────────────────────────────────────────────────────────
// Real finding: 81 "new" people on a delta re-import turned out to already
// be in the tree — the GEDCOM export just omitted their birth dates
// (Ancestry's usual privacy redaction for living people), and the match key
// needs a year on both sides. This corroborates via relationships instead.

test('findLikelyExistingMatches finds a dateless partner via an already-matched spouse', () => {
  const existingP = [
    { id: 'e_richard', display_name: 'Richard Partridge', birth_date: '1955' },
    { id: 'e_linda', display_name: 'Linda Partridge', birth_date: null },
  ];
  const existingR = [{ id: 'er1', type: 'partner', from_person: 'e_richard', to_person: 'e_linda' }];
  const newP = [
    { id: 'n_richard', display_name: 'Richard Partridge', birth_date: '1955' }, // collapses normally
    { id: 'n_linda', display_name: 'Linda Partridge', birth_date: null },       // stays "new" — no year
  ];
  const newR = [{ id: 'nr1', type: 'partner', from_person: 'n_richard', to_person: 'n_linda' }];
  const out = dedupeMergeImport(existingP, existingR, newP, newR);
  assert.deepEqual(out.people.map((p) => p.id), ['n_linda'], 'Linda still shows as new by the ordinary rule');

  const matches = findLikelyExistingMatches(existingP, existingR, newR, out.remap, out.people);
  assert.equal(matches.get('n_linda')?.id, 'e_linda', 'but she is corroborated via her already-matched husband');
});

test('findLikelyExistingMatches finds a dateless child via an already-matched parent', () => {
  const existingP = [
    { id: 'e_parent', display_name: 'John Ransom', birth_date: '1950' },
    { id: 'e_child', display_name: 'Jonathan Ransom', birth_date: null },
  ];
  const existingR = [{ id: 'er1', type: 'parent', from_person: 'e_parent', to_person: 'e_child' }];
  const newP = [
    { id: 'n_parent', display_name: 'John Ransom', birth_date: '1950' },
    { id: 'n_child', display_name: 'Jonathan Ransom', birth_date: null },
  ];
  const newR = [{ id: 'nr1', type: 'parent', from_person: 'n_parent', to_person: 'n_child' }];
  const out = dedupeMergeImport(existingP, existingR, newP, newR);
  const matches = findLikelyExistingMatches(existingP, existingR, newR, out.remap, out.people);
  assert.equal(matches.get('n_child')?.id, 'e_child');
});

test('findLikelyExistingMatches never flags a person whose relative resolved but whose name does not match anyone there', () => {
  const existingP = [
    { id: 'e_parent', display_name: 'John Ransom', birth_date: '1950' },
    { id: 'e_child', display_name: 'Someone Else', birth_date: null },
  ];
  const existingR = [{ id: 'er1', type: 'parent', from_person: 'e_parent', to_person: 'e_child' }];
  const newP = [
    { id: 'n_parent', display_name: 'John Ransom', birth_date: '1950' },
    { id: 'n_child', display_name: 'Jonathan Ransom', birth_date: null }, // no existing child with this name
  ];
  const newR = [{ id: 'nr1', type: 'parent', from_person: 'n_parent', to_person: 'n_child' }];
  const out = dedupeMergeImport(existingP, existingR, newP, newR);
  const matches = findLikelyExistingMatches(existingP, existingR, newR, out.remap, out.people);
  assert.equal(matches.has('n_child'), false);
});

test('findLikelyExistingMatches finds nothing for a genuinely new, unrelated person', () => {
  const existingP = [{ id: 'e1', display_name: 'John Ransom', birth_date: '1950' }];
  const newP = [{ id: 'n1', display_name: 'Totally New Person', birth_date: null }];
  const out = dedupeMergeImport(existingP, [], newP, []);
  const matches = findLikelyExistingMatches(existingP, [], [], out.remap, out.people);
  assert.equal(matches.size, 0);
});

test('summarizeMergeImport attaches _likelyExisting to a corroborated new person and null to an uncorroborated one', () => {
  const existingP = [
    { id: 'e_richard', display_name: 'Richard Partridge', birth_date: '1955' },
    { id: 'e_linda', display_name: 'Linda Partridge', birth_date: null },
  ];
  const existingR = [{ id: 'er1', type: 'partner', from_person: 'e_richard', to_person: 'e_linda' }];
  const newP = [
    { id: 'n_richard', display_name: 'Richard Partridge', birth_date: '1955' },
    { id: 'n_linda', display_name: 'Linda Partridge', birth_date: null },
    { id: 'n_stranger', display_name: 'Totally New Person', birth_date: null },
  ];
  const newR = [{ id: 'nr1', type: 'partner', from_person: 'n_richard', to_person: 'n_linda' }];
  const summary = summarizeMergeImport(existingP, existingR, newP, newR);
  const linda = summary.newPeople.find((p) => p.id === 'n_linda');
  const stranger = summary.newPeople.find((p) => p.id === 'n_stranger');
  assert.equal(linda._likelyExisting?.id, 'e_linda');
  assert.equal(stranger._likelyExisting, null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
