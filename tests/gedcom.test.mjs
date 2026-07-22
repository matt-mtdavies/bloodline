/**
 * Unit tests for lib/gedcom.js — focused on MARR (marriage) parsing, the gap
 * found when checking Ancestry.ca GEDCOM exports: couples linked but their
 * marriage date/place were dropped. Run with: node tests/gedcom.test.mjs
 */
import assert from 'node:assert/strict';
import { gedcomToStore, storeToGedcom } from '../src/lib/gedcom.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// Build a minimal FAM with two spouses, optionally with a MARR/DIV block.
function couple({ marr = '', div = false } = {}) {
  return `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Mary /Smith/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
${marr}${div ? '1 DIV\n2 DATE 2015\n' : ''}0 TRLR
`;
}
const partnerEdge = (store) => store.relationships.find((r) => r.type === 'partner');

test('MARR with a full DATE and PLAC stamps marriage_date (ISO) + marriage_place + is_married', () => {
  const store = gedcomToStore(couple({ marr: '1 MARR\n2 DATE 5 JUN 1975\n2 PLAC Ottawa, Ontario, Canada\n' }));
  const edge = partnerEdge(store);
  assert.ok(edge, 'a partner edge exists');
  assert.equal(edge.is_married, true);
  assert.equal(edge.marriage_date, '1975-06-05', 'full date preserved as ISO');
  assert.equal(edge.marriage_place, 'Ottawa, Ontario, Canada');
  assert.equal(edge.partner_status, 'current');
});

test('a MARR event with no DATE/PLAC still marks the couple as married', () => {
  const store = gedcomToStore(couple({ marr: '1 MARR\n' }));
  const edge = partnerEdge(store);
  assert.equal(edge.is_married, true);
  assert.equal(edge.marriage_date, null);
  assert.equal(edge.marriage_place, null);
});

test('a FAM with no MARR leaves the marriage fields unset (still a valid partnership)', () => {
  const store = gedcomToStore(couple({}));
  const edge = partnerEdge(store);
  assert.ok(edge, 'the couple is still linked as partners');
  assert.equal(edge.is_married, undefined, 'no marriage claimed without a MARR record');
  assert.equal(edge.marriage_date, undefined);
  assert.equal(edge.partner_status, 'current');
});

test('a divorced couple keeps the marriage date but reads as a former partner', () => {
  const store = gedcomToStore(couple({ marr: '1 MARR\n2 DATE 1975\n', div: true }));
  const edge = partnerEdge(store);
  assert.equal(edge.is_married, true, 'they were married');
  assert.equal(edge.marriage_date, '1975');
  assert.equal(edge.partner_status, 'former', 'DIV still downgrades them to a former partner');
});

// ── Date precision (so imported people get real birthdays) ──────────────────

function withBirth(dateLine) {
  return `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Ann /Lee/
1 BIRT
2 DATE ${dateLine}
0 TRLR
`;
}
const bd = (ged) => gedcomToStore(ged).people[0].birth_date;

test('an exact "D MMM YYYY" date becomes full ISO (so birthdays work)', () => {
  assert.equal(bd(withBirth('12 MAR 1950')), '1950-03-12');
  assert.equal(bd(withBirth('3 JUN 1988')), '1988-06-03', 'single-digit day is zero-padded');
});

test('a month+year date becomes YYYY-MM; a year-only date stays YYYY', () => {
  assert.equal(bd(withBirth('MAR 1950')), '1950-03');
  assert.equal(bd(withBirth('1950')), '1950');
});

test('approximate/range dates degrade to the year, never a faked day', () => {
  assert.equal(bd(withBirth('ABT 1950')), '1950');
  assert.equal(bd(withBirth('BET 1950 AND 1960')), '1950');
  assert.equal(bd(withBirth('ABT 12 MAR 1950')), '1950', 'an approximated exact date is not trusted to the day');
});

test('an Ancestry-style export (custom _APID/_MTTAG tags, OBJE media) parses and imports MARR', () => {
  const ged = `0 HEAD
1 SOUR Ancestry.com
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Smith/
1 OBJE
2 FILE http://mediasvc.ancestry.com/image/abc
1 _APID 1,1030::12345
1 FAMS @F1@
0 @I2@ INDI
1 NAME Mary /Smith/
1 _MTTAG @T1@
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1975
2 PLAC Ottawa, Ontario, Canada
0 TRLR
`;
  const store = gedcomToStore(ged);
  assert.equal(store.people.length, 2, 'both people import despite the custom tags');
  const edge = partnerEdge(store);
  assert.equal(edge.marriage_date, '1975');
  assert.equal(edge.marriage_place, 'Ottawa, Ontario, Canada');
});

// ── Writer: storeToGedcom, and round-trip through the parser ────────────────

// A controlled tree exercising the fields GEDCOM can carry: a married couple
// with a place, a deceased grandparent with a full date + occupation + bio, a
// divorced couple, a single-parent child, and an adopted child.
const tree = {
  people: [
    { id: 'gpa', display_name: 'Arthur Vale', given_names: 'Arthur', family_name: 'Vale', gender: 'male', birth_date: '1928', death_date: '2009-05-14', is_deceased: true, occupation: 'Railwayman', bio: 'Loved the trains.', birth_place: 'Cardiff, Wales' },
    { id: 'dad', display_name: 'Robert Vale', given_names: 'Robert', family_name: 'Vale', gender: 'male', birth_date: '1958-03-12' },
    { id: 'mum', display_name: 'Linda Vale', given_names: 'Linda', family_name: 'Vale', gender: 'female', birth_date: '1960' },
    { id: 'kid', display_name: 'James Vale', given_names: 'James', family_name: 'Vale', gender: 'male', birth_date: '1985-04-12', birth_place: 'Bristol, England' },
    { id: 'ada', display_name: 'Ada Vale', given_names: 'Ada', family_name: 'Vale', gender: 'female', birth_date: '1988' }, // adopted
    { id: 'exw', display_name: 'Carol Vale', given_names: 'Carol', family_name: 'Vale', gender: 'female', birth_date: '1959' }, // divorced from gpa's line
  ],
  relationships: [
    { id: 'r1', type: 'parent', from_person: 'gpa', to_person: 'dad', qualifier: 'biological', partner_status: null },
    { id: 'r2', type: 'partner', from_person: 'dad', to_person: 'mum', qualifier: 'biological', partner_status: 'current', is_married: true, marriage_date: '1983-06-04', marriage_place: 'Canterbury' },
    { id: 'r3', type: 'parent', from_person: 'dad', to_person: 'kid', qualifier: 'biological', partner_status: null },
    { id: 'r4', type: 'parent', from_person: 'mum', to_person: 'kid', qualifier: 'biological', partner_status: null },
    { id: 'r5', type: 'parent', from_person: 'dad', to_person: 'ada', qualifier: 'adoptive', partner_status: null },
    { id: 'r6', type: 'parent', from_person: 'mum', to_person: 'ada', qualifier: 'adoptive', partner_status: null },
    { id: 'r7', type: 'partner', from_person: 'gpa', to_person: 'exw', qualifier: 'biological', partner_status: 'former' },
    { id: 'r8', type: 'parent', from_person: 'exw', to_person: 'dad', qualifier: 'biological', partner_status: null }, // single-parent path already covered by gpa; exw co-parents dad
  ],
};

const findBy = (people, name) => people.find((p) => p.display_name === name);

test('storeToGedcom emits valid records the parser reads back', () => {
  const ged = storeToGedcom(tree.people, tree.relationships);
  assert.match(ged, /^0 HEAD/);
  assert.match(ged, /2 VERS 5\.5\.1/);
  assert.match(ged, /0 @I\d+@ INDI/);
  assert.match(ged, /1 NAME Arthur \/Vale\//);
  assert.match(ged, /0 TRLR\n$/);
});

test('round-trip preserves people and their GEDCOM-expressible fields', () => {
  const back = gedcomToStore(storeToGedcom(tree.people, tree.relationships));
  assert.equal(back.people.length, tree.people.length, 'same number of people');

  const gpa = findBy(back.people, 'Arthur Vale');
  assert.equal(gpa.birth_date, '1928');
  assert.equal(gpa.death_date, '2009-05-14', 'full death date survives');
  assert.equal(gpa.is_deceased, true);
  assert.equal(gpa.occupation, 'Railwayman');
  assert.equal(gpa.bio, 'Loved the trains.');
  assert.equal(gpa.birth_place, 'Cardiff, Wales');

  const kid = findBy(back.people, 'James Vale');
  assert.equal(kid.birth_date, '1985-04-12', 'full birth date survives (so birthdays still work)');
  assert.equal(kid.gender, 'male');
});

test('round-trip preserves marriage (date + place), divorce, and adoption', () => {
  const back = gedcomToStore(storeToGedcom(tree.people, tree.relationships));
  const id = (name) => findBy(back.people, name).id;

  const partnerEdges = back.relationships.filter((r) => r.type === 'partner');
  const married = partnerEdges.find((r) => (r.from_person === id('Robert Vale') && r.to_person === id('Linda Vale')) || (r.from_person === id('Linda Vale') && r.to_person === id('Robert Vale')));
  assert.ok(married, 'the married couple round-trips');
  assert.equal(married.is_married, true);
  assert.equal(married.marriage_date, '1983-06-04', 'full marriage date survives');
  assert.equal(married.marriage_place, 'Canterbury');
  assert.equal(married.partner_status, 'current');

  const divorced = partnerEdges.find((r) => [r.from_person, r.to_person].sort().join() === [id('Arthur Vale'), id('Carol Vale')].sort().join());
  assert.ok(divorced, 'the divorced couple round-trips');
  assert.equal(divorced.partner_status, 'former', 'DIV survives as a former partner');

  // Ada is adopted by both parents — the qualifier survives on her parent edges.
  const adaParentEdges = back.relationships.filter((r) => r.type === 'parent' && r.to_person === id('Ada Vale'));
  assert.equal(adaParentEdges.length, 2);
  assert.ok(adaParentEdges.every((r) => r.qualifier === 'adoptive'), 'adoption (PEDI) survives on both parent edges');
});

test('a childless couple and an isolated person both round-trip', () => {
  const people = [
    { id: 'a', display_name: 'Sam Real', given_names: 'Sam', family_name: 'Real', gender: 'male', birth_date: '1970' },
    { id: 'b', display_name: 'Pat Real', given_names: 'Pat', family_name: 'Real', gender: 'female', birth_date: '1972' },
    { id: 'c', display_name: 'Lone Soul', given_names: 'Lone', family_name: 'Soul', gender: null, birth_date: '1900' },
  ];
  const rels = [{ id: 'p', type: 'partner', from_person: 'a', to_person: 'b', qualifier: 'biological', partner_status: 'current', is_married: true, marriage_date: '1995' }];
  const back = gedcomToStore(storeToGedcom(people, rels));
  assert.equal(back.people.length, 3, 'the isolated person survives');
  const partners = back.relationships.filter((r) => r.type === 'partner');
  assert.equal(partners.length, 1, 'the childless couple still links');
  assert.equal(partners[0].marriage_date, '1995');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
