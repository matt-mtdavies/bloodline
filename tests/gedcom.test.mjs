/**
 * Unit tests for lib/gedcom.js — focused on MARR (marriage) parsing, the gap
 * found when checking Ancestry.ca GEDCOM exports: couples linked but their
 * marriage date/place were dropped. Run with: node tests/gedcom.test.mjs
 */
import assert from 'node:assert/strict';
import { gedcomToStore } from '../src/lib/gedcom.js';

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

test('MARR with a DATE and PLAC stamps marriage_date (year) + marriage_place + is_married', () => {
  const store = gedcomToStore(couple({ marr: '1 MARR\n2 DATE 5 JUN 1975\n2 PLAC Ottawa, Ontario, Canada\n' }));
  const edge = partnerEdge(store);
  assert.ok(edge, 'a partner edge exists');
  assert.equal(edge.is_married, true);
  assert.equal(edge.marriage_date, '1975', 'reduced to year, matching birth/death date handling');
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

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
