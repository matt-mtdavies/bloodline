/**
 * Insight cohort enforcement (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
 * §4.4/§6.9, Phase 6). "Enforcement is required, not merely a review
 * convention" — this test enumerates every module computeInsightModules
 * actually registers and fails if any of them lacks a declared cohort, or
 * declares one that isn't a real cohort. It also proves cohort-scoping
 * itself actually narrows which people a module counts, not just that a
 * declaration exists on paper.
 * Run with: node tests/insightCohortEnforcement.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import {
  computeInsightModules,
  insightModuleCohort,
  allInsightModuleKeys,
  VALID_INSIGHT_COHORTS,
} from '../src/lib/insightModules.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });

// ── Enforcement: every REGISTERED module has a declared, valid cohort ────

test('every module computeInsightModules actually registers has a declared cohort', () => {
  // The real, current module list — computed from a graph with enough
  // data that no module returns early/undefined for lack of a key at all
  // (we're checking the KEY SET computeInsightModules registers, not
  // whether each module's data threshold is met).
  const g = buildGraph([person('a')], []);
  const registeredKeys = Object.keys(computeInsightModules(g, 'a'));
  assert.ok(registeredKeys.length > 20, 'sanity check: this must be the real ~26-module list, not an empty/stub result');
  for (const key of registeredKeys) {
    const cohort = insightModuleCohort(key);
    assert.ok(cohort, `module "${key}" has no declared cohort in MODULE_COHORTS — every registered module must declare one (§4.4)`);
  }
});

test('every declared cohort is one of the five real cohorts from §4.4\'s table', () => {
  for (const key of allInsightModuleKeys()) {
    const cohort = insightModuleCohort(key);
    assert.ok(VALID_INSIGHT_COHORTS.has(cohort), `module "${key}" declares an unrecognized cohort "${cohort}"`);
  }
});

test('MODULE_COHORTS has no stale/orphaned entries — every declared key is also a real registered module', () => {
  const g = buildGraph([person('a')], []);
  const registered = new Set(Object.keys(computeInsightModules(g, 'a')));
  for (const key of allInsightModuleKeys()) {
    assert.ok(registered.has(key), `MODULE_COHORTS declares "${key}" but computeInsightModules never registers it`);
  }
});

// ── Cohort scoping actually narrows aggregation, not just declared on paper ─

function twoTierFamily() {
  // Personal cohort: two distinct surnames (Alpha x4, Gamma x3) — enough
  // groups on their own to clear surnames()'s own "at least 2 groups"
  // threshold once scoped, so a narrowed result isn't confused with the
  // module's own null-below-threshold case. Plus 3 "outside" people
  // sharing a THIRD surname (Beta) — surnames() is a personal-cohort
  // module, so scoping to `personal` must never let the outside trio's
  // surname dominate or even appear.
  const people = [
    person('v', { display_name: 'Viewer Alpha' }),
    person('p1', { display_name: 'Kin Alpha' }),
    person('p2', { display_name: 'Kin Alpha' }),
    person('p3', { display_name: 'Kin Alpha' }),
    person('g1', { display_name: 'Kin Gamma' }),
    person('g2', { display_name: 'Kin Gamma' }),
    person('g3', { display_name: 'Kin Gamma' }),
    person('o1', { display_name: 'Stranger Beta' }),
    person('o2', { display_name: 'Stranger Beta' }),
    person('o3', { display_name: 'Stranger Beta' }),
  ];
  return buildGraph(people, []);
}

test('cohortIds actually narrows a personal-cohort module\'s aggregate — the excluded people never appear in surnames()', () => {
  const g = twoTierFamily();
  const cohortIds = {
    personal: new Set(['v', 'p1', 'p2', 'p3', 'g1', 'g2', 'g3']),
    context: new Set(),
    complete: new Set(g.people.map((p) => p.id)),
    directLine: new Set(),
    temporaryReveal: new Set(),
  };
  const withoutCohort = computeInsightModules(g, 'v', 0, null, null, {});
  const withCohort = computeInsightModules(g, 'v', 0, null, null, { cohortIds });

  // Without a cohort (today's default / every pre-Phase-6 caller): all
  // three surnames show up, complete-tree behavior, byte-identical to before.
  const namesWithout = withoutCohort.surnames.top.map((s) => s.name);
  assert.ok(namesWithout.includes('Alpha') && namesWithout.includes('Beta') && namesWithout.includes('Gamma'), 'sanity: without cohortIds, all three surnames appear (unscoped, complete-tree default)');

  // With the personal cohort applied: Alpha and Gamma (the personal
  // cohort's own surnames) appear — Beta (the excluded outside trio) must
  // never show up in a module declared `personal`.
  assert.ok(withCohort.surnames, 'sanity: the scoped personal cohort must still clear the module\'s own 2-group threshold');
  const namesWith = withCohort.surnames.top.map((s) => s.name);
  assert.ok(namesWith.includes('Alpha') && namesWith.includes('Gamma'));
  assert.ok(!namesWith.includes('Beta'), 'a personal-cohort module must never let excluded people leak into its aggregate');
});

test('cohortIds leaves a complete-cohort module (bridges) unaffected by the personal/outside split — it is a whole-tree structural property by design', () => {
  // bridges() needs >=25 people and a real articulation point to return
  // non-null; build a minimal two-lobe bridge graph, then wrap it in the
  // SAME twoTierFamily-style personal/outside split and confirm bridges()
  // still sees the complete tree either way (declared cohort: complete).
  const lobeA = Array.from({ length: 12 }, (_, i) => person(`a${i}`));
  const lobeB = Array.from({ length: 12 }, (_, i) => person(`b${i}`));
  const hub = person('hub');
  const people = [...lobeA, ...lobeB, hub];
  const rels = [];
  for (let i = 0; i < lobeA.length - 1; i++) rels.push({ type: 'parent', from_person: lobeA[i].id, to_person: lobeA[i + 1].id, qualifier: 'biological', partner_status: null });
  for (let i = 0; i < lobeB.length - 1; i++) rels.push({ type: 'parent', from_person: lobeB[i].id, to_person: lobeB[i + 1].id, qualifier: 'biological', partner_status: null });
  rels.push({ type: 'parent', from_person: lobeA[lobeA.length - 1].id, to_person: hub.id, qualifier: 'biological', partner_status: null });
  rels.push({ type: 'parent', from_person: hub.id, to_person: lobeB[0].id, qualifier: 'biological', partner_status: null });
  const g = buildGraph(people, rels);

  const cohortIds = {
    personal: new Set(lobeA.map((p) => p.id).concat(['hub'])), // deliberately excludes lobeB entirely
    context: new Set(),
    complete: new Set(g.people.map((p) => p.id)),
    directLine: new Set(),
    temporaryReveal: new Set(),
  };
  const withoutCohort = computeInsightModules(g, 'hub', 0, null, null, {}).bridges;
  const withCohort = computeInsightModules(g, 'hub', 0, null, null, { cohortIds }).bridges;
  assert.ok(withoutCohort, 'sanity: this fixture must actually produce a bridge result');
  assert.deepEqual(withCohort, withoutCohort, 'bridges (declared complete) must see the whole tree regardless of any personal/outside split');
});

test('an unrecognized cohort key in cohortIds degrades to the complete graph rather than silently reporting zero facts', () => {
  const g = twoTierFamily();
  const brokenCohortIds = { personal: undefined, context: new Set(), complete: new Set(g.people.map((p) => p.id)), directLine: new Set(), temporaryReveal: new Set() };
  const result = computeInsightModules(g, 'v', 0, null, null, { cohortIds: brokenCohortIds }).surnames;
  const names = result.top.map((s) => s.name);
  assert.ok(names.includes('Alpha') && names.includes('Beta') && names.includes('Gamma'), 'a malformed cohort entry must fail safe to the complete graph, not silently empty out the module');
});

test('the `only` option skips computing every module not requested — the returned object literally does not contain the other keys', () => {
  const g = twoTierFamily();
  const result = computeInsightModules(g, 'v', 0, null, null, { only: ['surnames', 'brood'] });
  assert.deepEqual(Object.keys(result).sort(), ['brood', 'surnames']);
});

test('the `only` option never computes `bridges` unless explicitly requested — Home\'s small preselected set must be able to skip the expensive module entirely', () => {
  const g = twoTierFamily();
  const result = computeInsightModules(g, 'v', 0, null, null, { only: ['surnames'] });
  assert.ok(!('bridges' in result), 'bridges must not even be a key on the result when not requested via `only`');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
