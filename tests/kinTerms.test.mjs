/**
 * Unit tests for lib/kinTerms.js — the grandparent term-pack resolver and
 * its localStorage-backed pref store. Run with: node tests/kinTerms.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph, relationLabel } from '../src/data/graph.js';
import {
  resolveGrandparentTerm, resolveAncestorTerm, setKinTermsPref, kinTermsStore, CUSTOM_PACK_ID,
} from '../src/lib/kinTerms.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const DEFAULT_PREF = {
  paternalPackId: 'english_formal',
  maternalPackId: 'english_formal',
  customPaternal: { male: '', female: '' },
  customMaternal: { male: '', female: '' },
};

// ── resolveGrandparentTerm: pure resolver ──────────────────────────────────

test('default pref resolves to plain English, gendered', () => {
  assert.equal(resolveGrandparentTerm(DEFAULT_PREF, 'Paternal', 'male'), 'Grandfather');
  assert.equal(resolveGrandparentTerm(DEFAULT_PREF, 'Maternal', 'female'), 'Grandmother');
});

test('unknown gender resolves to the pack\'s neutral term', () => {
  assert.equal(resolveGrandparentTerm(DEFAULT_PREF, 'Paternal', null), 'Grandparent');
});

test('side selects an independent pack — paternal Italian, maternal German', () => {
  const pref = { ...DEFAULT_PREF, paternalPackId: 'italian', maternalPackId: 'german' };
  assert.equal(resolveGrandparentTerm(pref, 'Paternal', 'male'), 'Nonno');
  assert.equal(resolveGrandparentTerm(pref, 'Paternal', 'female'), 'Nonna');
  assert.equal(resolveGrandparentTerm(pref, 'Maternal', 'male'), 'Opa');
  assert.equal(resolveGrandparentTerm(pref, 'Maternal', 'female'), 'Oma');
});

test('side=null (connecting parent\'s gender unrecorded) falls back to the paternal pack', () => {
  const pref = { ...DEFAULT_PREF, paternalPackId: 'spanish', maternalPackId: 'french' };
  assert.equal(resolveGrandparentTerm(pref, null, 'male'), 'Abuelo');
});

test('custom pack uses the family\'s own words, falling back to English where blank', () => {
  const pref = { ...DEFAULT_PREF, paternalPackId: CUSTOM_PACK_ID, customPaternal: { male: 'Pop', female: 'Gigi' } };
  assert.equal(resolveGrandparentTerm(pref, 'Paternal', 'male'), 'Pop');
  assert.equal(resolveGrandparentTerm(pref, 'Paternal', 'female'), 'Gigi');
  assert.equal(resolveGrandparentTerm(pref, 'Paternal', null), 'Pop/Gigi');

  const blank = { ...DEFAULT_PREF, paternalPackId: CUSTOM_PACK_ID, customPaternal: { male: '', female: '' } };
  assert.equal(resolveGrandparentTerm(blank, 'Paternal', 'male'), 'Grandfather');
});

// ── resolveAncestorTerm: the "Great-" extension ────────────────────────────

test('resolveAncestorTerm with greats=0 is identical to resolveGrandparentTerm', () => {
  const pref = { ...DEFAULT_PREF, maternalPackId: 'german' };
  assert.equal(resolveAncestorTerm(pref, 'Maternal', 'female', 0), 'Oma');
});

test('resolveAncestorTerm prefixes "Great-" without touching the term\'s own casing', () => {
  const pref = { ...DEFAULT_PREF, maternalPackId: 'german', paternalPackId: 'italian' };
  assert.equal(resolveAncestorTerm(pref, 'Maternal', 'female', 1), 'Great-Oma');
  assert.equal(resolveAncestorTerm(pref, 'Paternal', 'male', 1), 'Great-Nonno');
});

test('resolveAncestorTerm stacks "great-" for deeper generations (great-great-, ...)', () => {
  const pref = { ...DEFAULT_PREF, maternalPackId: 'german' };
  assert.equal(resolveAncestorTerm(pref, 'Maternal', 'female', 2), 'Great-great-Oma');
  assert.equal(resolveAncestorTerm(pref, 'Maternal', 'female', 3), 'Great-great-great-Oma');
});

// ── kinTermsStore: partial updates + pub/sub ───────────────────────────────

test('setKinTermsPref merges a partial patch without clobbering the rest', () => {
  setKinTermsPref({ ...DEFAULT_PREF }); // reset to a known baseline
  setKinTermsPref({ paternalPackId: 'italian' });
  const p = kinTermsStore.getState();
  assert.equal(p.paternalPackId, 'italian');
  assert.equal(p.maternalPackId, 'english_formal', 'unrelated fields must survive a partial patch');
});

test('setKinTermsPref notifies subscribers', () => {
  setKinTermsPref({ ...DEFAULT_PREF });
  let calls = 0;
  const unsub = kinTermsStore.subscribe(() => { calls++; });
  setKinTermsPref({ maternalPackId: 'french' });
  unsub();
  assert.equal(calls, 1);
});

// ── relationLabel: the actual integration point ────────────────────────────

const person = (id, gender = null) => ({ id, display_name: id, gender, is_deceased: false });
const parentEdge = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null,
});

function familyWithGrandparents() {
  // dad's parents: grandpa (m) / grandma (f) — paternal side
  // mum's parents: opa (m) / oma (f) — maternal side
  return buildGraph(
    [
      person('me'), person('dad', 'male'), person('mum', 'female'),
      person('grandpa', 'male'), person('grandma', 'female'),
      person('opa', 'male'), person('oma', 'female'),
    ],
    [
      parentEdge('dad', 'me'), parentEdge('mum', 'me'),
      parentEdge('grandpa', 'dad'), parentEdge('grandma', 'dad'),
      parentEdge('opa', 'mum'), parentEdge('oma', 'mum'),
    ],
  );
}

test('relationLabel with no kinTerms behaves exactly as before (English, side-prefixed)', () => {
  const g = familyWithGrandparents();
  assert.equal(relationLabel(g, 'me', 'grandpa'), 'Paternal Grandfather');
  assert.equal(relationLabel(g, 'me', 'oma'), 'Maternal Grandmother');
});

test('relationLabel with a resolved kinTerms pref swaps the noun but keeps the side prefix', () => {
  const g = familyWithGrandparents();
  const pref = { ...DEFAULT_PREF, paternalPackId: 'italian', maternalPackId: 'german' };
  assert.equal(relationLabel(g, 'me', 'grandpa', pref), 'Paternal Nonno');
  assert.equal(relationLabel(g, 'me', 'grandma', pref), 'Paternal Nonna');
  assert.equal(relationLabel(g, 'me', 'opa', pref), 'Maternal Opa');
  assert.equal(relationLabel(g, 'me', 'oma', pref), 'Maternal Oma');
});

test('relationLabel: step/adoptive grandparents are untouched by kinTerms (no gender split to swap)', () => {
  const g = buildGraph(
    [person('me'), person('stepdad', 'male'), person('stepgp', 'male')],
    [parentEdge('stepdad', 'me', 'step'), parentEdge('stepgp', 'stepdad')],
  );
  const pref = { ...DEFAULT_PREF, paternalPackId: 'italian' };
  assert.equal(relationLabel(g, 'me', 'stepgp', pref), 'Step Grandparent');
});

// ── relationLabel: extended to Great-grandparents and beyond ──────────────
// Real user report: "it has not changed the Great-Oma?? still says
// great-grandma" — the custom term was only ever wired into the direct
// grandparent branch. Extended one generation further back (and beyond),
// reusing the exact same side/gender resolution.

function familyWithGreatGrandparents() {
  // Extends familyWithGrandparents: grandpa's parents are ggpa (m) / ggma
  // (f) — still paternal side overall — and ggpa's own parents (gggpa/
  // gggma) for a great-great-grandparent case.
  const g = familyWithGrandparents();
  return buildGraph(
    [
      ...g.people,
      person('ggpa', 'male'), person('ggma', 'female'),
      person('gggpa', 'male'), person('gggma', 'female'),
    ],
    [
      ...g.relationships,
      parentEdge('ggpa', 'grandpa'), parentEdge('ggma', 'grandpa'),
      parentEdge('gggpa', 'ggpa'), parentEdge('gggma', 'ggpa'),
    ],
  );
}

test('relationLabel with no kinTerms: great-grandparent unchanged (plain English, no side prefix)', () => {
  const g = familyWithGreatGrandparents();
  assert.equal(relationLabel(g, 'me', 'ggpa'), 'Great-grandfather');
  assert.equal(relationLabel(g, 'me', 'ggma'), 'Great-grandmother');
});

test('relationLabel with a resolved kinTerms pref extends to "Great-" + the chosen term', () => {
  const g = familyWithGreatGrandparents();
  const pref = { ...DEFAULT_PREF, paternalPackId: 'german' };
  assert.equal(relationLabel(g, 'me', 'ggpa', pref), 'Great-Opa');
  assert.equal(relationLabel(g, 'me', 'ggma', pref), 'Great-Oma');
});

test('relationLabel stacks "great-" further back (great-great-grandparent)', () => {
  const g = familyWithGreatGrandparents();
  const pref = { ...DEFAULT_PREF, paternalPackId: 'german' };
  // Unlike the exactly-great-grandparent case above, 4+ generations up is
  // handled by the general fallback, which already carried a side prefix
  // for the plain-English case — unchanged here, just with the custom term.
  assert.equal(relationLabel(g, 'me', 'gggpa', pref), 'Paternal Great-great-Opa');
  assert.equal(relationLabel(g, 'me', 'gggma', pref), 'Paternal Great-great-Oma');
});

test('relationLabel: step/adoptive great-grandparents are untouched by kinTerms', () => {
  const g = buildGraph(
    [person('me'), person('dad', 'male'), person('stepgp', 'male'), person('stepggp', 'male')],
    [parentEdge('dad', 'me'), parentEdge('stepgp', 'dad', 'step'), parentEdge('stepggp', 'stepgp')],
  );
  const pref = { ...DEFAULT_PREF, paternalPackId: 'italian' };
  assert.equal(relationLabel(g, 'me', 'stepggp', pref), 'Step Great-grandparent');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
