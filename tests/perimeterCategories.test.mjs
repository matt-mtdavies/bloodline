/**
 * Unit tests for src/lib/perimeterCategories.js — pure category
 * classification shared by the Perimeter Preview list and genogram.
 *
 * Run with: node tests/perimeterCategories.test.mjs
 */
import assert from 'node:assert/strict';
import {
  categoryFor,
  secondarySortValue,
  groupPeopleByCategory,
  categoryQualifiesAtLevel,
  CATEGORY_META,
  GENOGRAM_ROWS,
} from '../src/lib/perimeterCategories.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL  ${label}\n  ${e.stack || e.message}`); }
}

// A minimal graph stub — categoryFor only ever calls graph.partners(viewerId)
// (for the 'everyone' route branch) and groupPeopleByCategory only ever
// calls graph.byId.get(id).
function fakeGraph(people, partnersOfViewer = []) {
  return {
    byId: new Map(people.map((p) => [p.id, p])),
    partners: () => partnersOfViewer,
  };
}

const V = 'v';

// ── categoryFor: direct line ────────────────────────────────────────────

test('categoryFor: missing reason degrades to "other"', () => {
  assert.equal(categoryFor('x', V, fakeGraph([]), null), 'other');
});

test('categoryFor: anchor route (viewer or current partner) is "you"', () => {
  assert.equal(categoryFor(V, V, fakeGraph([]), { tier: 'primary', route: 'anchor' }), 'you');
});

test('categoryFor: ancestor distances 1/2/3+ map to parents/grandparents/great-grandparents', () => {
  const g = fakeGraph([]);
  assert.equal(categoryFor('p', V, g, { tier: 'primary', route: 'ancestor', closeness: [1] }), 'parents');
  assert.equal(categoryFor('gp', V, g, { tier: 'primary', route: 'ancestor', closeness: [2] }), 'grandparents');
  assert.equal(categoryFor('ggp', V, g, { tier: 'primary', route: 'ancestor', closeness: [3] }), 'greatGrandparents');
  assert.equal(categoryFor('gggp', V, g, { tier: 'primary', route: 'ancestor', closeness: [5] }), 'greatGrandparents');
});

test('categoryFor: descendant distances 1/2/3+ map to children/grandchildren/great-grandchildren', () => {
  const g = fakeGraph([]);
  assert.equal(categoryFor('c', V, g, { tier: 'primary', route: 'descendant', closeness: [1] }), 'children');
  assert.equal(categoryFor('gc', V, g, { tier: 'primary', route: 'descendant', closeness: [2] }), 'grandchildren');
  assert.equal(categoryFor('ggc', V, g, { tier: 'primary', route: 'descendant', closeness: [4] }), 'greatGrandchildren');
});

// ── categoryFor: the degree-0 collateral split (the real bug this fixes) ──

test('categoryFor: degree 0, removal 0 is a Sibling', () => {
  const g = fakeGraph([]);
  assert.equal(
    categoryFor('sib', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 0, side: 'same' }),
    'siblings',
  );
});

test('categoryFor: degree 0, removal 1, side "older" is an Aunt/Uncle — NOT a sibling', () => {
  const g = fakeGraph([]);
  const cat = categoryFor('auntP', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 1, side: 'older' });
  assert.equal(cat, 'auntsUncles');
  assert.notEqual(cat, 'siblings');
});

test('categoryFor: degree 0, removal 1, side "younger" is a Niece/Nephew', () => {
  const g = fakeGraph([]);
  assert.equal(
    categoryFor('kid', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 1, side: 'younger' }),
    'niecesNephews',
  );
});

test('categoryFor: degree 0, removal 2+, side "older" is Great-aunts & Great-uncles', () => {
  const g = fakeGraph([]);
  assert.equal(
    categoryFor('greatAunt', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 2, side: 'older' }),
    'greatAuntsUncles',
  );
  assert.equal(
    categoryFor('further', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 4, side: 'older' }),
    'greatAuntsUncles',
  );
});

test('categoryFor: degree 0, removal 2+, side "younger" is Grand-nieces & Grand-nephews', () => {
  const g = fakeGraph([]);
  assert.equal(
    categoryFor('grandNephew', V, g, { tier: 'primary', route: 'cousin', degree: 0, removal: 2, side: 'younger' }),
    'grandNiecesNephews',
  );
});

test('categoryFor: degree 1/2/3 map to 1st/2nd/3rd cousins regardless of removal', () => {
  const g = fakeGraph([]);
  assert.equal(categoryFor('c1', V, g, { tier: 'primary', route: 'cousin', degree: 1, removal: 2 }), 'cousins1');
  assert.equal(categoryFor('c2', V, g, { tier: 'primary', route: 'cousin', degree: 2, removal: 0 }), 'cousins2');
  assert.equal(categoryFor('c3', V, g, { tier: 'primary', route: 'cousin', degree: 3, removal: 1 }), 'cousins3');
});

// ── categoryFor: halo / partner-context / everyone ──────────────────────

test('categoryFor: familyHalo tier is always "Connected through marriage" regardless of route', () => {
  const g = fakeGraph([]);
  assert.equal(categoryFor('x', V, g, { tier: 'familyHalo', route: 'sibling' }), 'halo');
  assert.equal(categoryFor('x', V, g, { tier: 'familyHalo', route: 'parent' }), 'halo');
});

test('categoryFor: partnerContext tier is always "Your partner\'s family"', () => {
  const g = fakeGraph([]);
  assert.equal(categoryFor('x', V, g, { tier: 'partnerContext', route: 'parent' }), 'partnerFamily');
});

test('categoryFor: "everyone" route — viewer and current partner are "you", everyone else is "everyone"', () => {
  const g = fakeGraph([], [{ id: 'partner', status: 'current' }, { id: 'ex', status: 'former' }]);
  assert.equal(categoryFor(V, V, g, { tier: 'primary', route: 'everyone' }), 'you');
  assert.equal(categoryFor('partner', V, g, { tier: 'primary', route: 'everyone' }), 'you');
  assert.equal(categoryFor('ex', V, g, { tier: 'primary', route: 'everyone' }), 'everyone');
  assert.equal(categoryFor('stranger', V, g, { tier: 'primary', route: 'everyone' }), 'everyone');
});

// ── secondarySortValue ────────────────────────────────────────────────────

test('secondarySortValue: the viewer always sorts first (-1) regardless of reason', () => {
  assert.equal(secondarySortValue(V, V, { route: 'anchor', closeness: [0] }), -1);
});

test('secondarySortValue: cousin route sorts by removal', () => {
  assert.equal(secondarySortValue('x', V, { route: 'cousin', removal: 3 }), 3);
});

test('secondarySortValue: ancestor/descendant sorts by closeness[0]', () => {
  assert.equal(secondarySortValue('x', V, { route: 'ancestor', closeness: [2] }), 2);
});

test('secondarySortValue: missing reason is 0', () => {
  assert.equal(secondarySortValue('x', V, null), 0);
});

// ── groupPeopleByCategory ──────────────────────────────────────────────

test('groupPeopleByCategory: groups perimeter members by category, ignores non-perimeter people', () => {
  const people = [
    { id: 'v', display_name: 'Viewer' },
    { id: 'dad', display_name: 'Dad' },
    { id: 'sib', display_name: 'Sib' },
  ];
  const g = fakeGraph(people);
  const idx = {
    perimeterIds: new Set(['v', 'dad', 'sib']),
    inclusionReasonById: new Map([
      ['v', { tier: 'primary', route: 'anchor' }],
      ['dad', { tier: 'primary', route: 'ancestor', closeness: [1] }],
      ['sib', { tier: 'primary', route: 'cousin', degree: 0, removal: 0, side: 'same' }],
    ]),
  };
  const grouped = groupPeopleByCategory(idx, V, g);
  assert.equal(grouped.get('you').length, 1);
  assert.equal(grouped.get('parents').length, 1);
  assert.equal(grouped.get('siblings').length, 1);
  assert.equal(grouped.get('parents')[0].person.display_name, 'Dad');
});

test('groupPeopleByCategory: filterTerm narrows by case-insensitive display_name substring', () => {
  const people = [
    { id: 'v', display_name: 'Viewer' },
    { id: 'dad', display_name: 'Robert Mercer' },
    { id: 'mum', display_name: 'Linda Mercer' },
  ];
  const g = fakeGraph(people);
  const idx = {
    perimeterIds: new Set(['dad', 'mum']),
    inclusionReasonById: new Map([
      ['dad', { tier: 'primary', route: 'ancestor', closeness: [1] }],
      ['mum', { tier: 'primary', route: 'ancestor', closeness: [1] }],
    ]),
  };
  const grouped = groupPeopleByCategory(idx, V, g, { filterTerm: 'robert' });
  assert.equal(grouped.get('parents').length, 1);
  assert.equal(grouped.get('parents')[0].person.display_name, 'Robert Mercer');
});

// ── categoryQualifiesAtLevel ─────────────────────────────────────────────

test('categoryQualifiesAtLevel: cousins2 only qualifies at level 2/3/everyone, not level 1', () => {
  assert.equal(categoryQualifiesAtLevel('cousins2', 1), false);
  assert.equal(categoryQualifiesAtLevel('cousins2', 2), true);
  assert.equal(categoryQualifiesAtLevel('cousins2', 3), true);
  assert.equal(categoryQualifiesAtLevel('cousins2', 'everyone'), true);
});

test('categoryQualifiesAtLevel: cousins3 only qualifies at level 3/everyone', () => {
  assert.equal(categoryQualifiesAtLevel('cousins3', 1), false);
  assert.equal(categoryQualifiesAtLevel('cousins3', 2), false);
  assert.equal(categoryQualifiesAtLevel('cousins3', 3), true);
  assert.equal(categoryQualifiesAtLevel('cousins3', 'everyone'), true);
});

test('categoryQualifiesAtLevel: every other category (direct line, degree-0 collateral, cousins1) always qualifies', () => {
  for (const cat of ['parents', 'siblings', 'auntsUncles', 'niecesNephews', 'children', 'grandparents', 'cousins1', 'halo']) {
    assert.equal(categoryQualifiesAtLevel(cat, 1), true, `${cat} should qualify at level 1`);
  }
});

// ── shape sanity ──────────────────────────────────────────────────────────

test('every category referenced by GENOGRAM_ROWS chips has a CATEGORY_META entry', () => {
  for (const row of GENOGRAM_ROWS) {
    for (const chip of row.chips) {
      assert.ok(CATEGORY_META[chip.cat], `GENOGRAM_ROWS references unknown category "${chip.cat}"`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
