/**
 * Unit tests for lib/insightModules.js — the Wave-1 visual insight modules.
 * Focus: thresholds hide modules on thin data, and the derivations are right
 * on a synthetic tree rich enough to light everything up.
 * Run with: node tests/insightModules.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computeInsightModules } from '../src/lib/insightModules.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── Synthetic tree builder ──────────────────────────────────────────────────
// 4 generations, full dates, repeated names, shared birthplaces, big broods,
// a pair of cross-generation birthday twins — everything above threshold.
function richTree() {
  const people = [];
  const rels = [];
  let rid = 0;
  const addPerson = (id, name, birth, death, place) => {
    people.push({
      id, display_name: name,
      birth_date: birth, death_date: death || undefined,
      is_deceased: !!death, birth_place: place || '',
    });
  };
  const addParent = (parentId, childId) => {
    rels.push({ id: `r${rid++}`, type: 'parent', from_person: parentId, to_person: childId, qualifier: 'biological' });
  };
  const addPartner = (a, b) => {
    rels.push({ id: `r${rid++}`, type: 'partner', from_person: a, to_person: b, partner_status: 'current' });
  };

  // G1: five founding couples born 1820s, died in their 40s-50s.
  // Their children (G2, born 1850s) live to ~70; G3 (1890s) to ~80.
  const names = ['John', 'Margaret', 'John', 'Sarah', 'John', 'Margaret', 'David', 'Sarah', 'David', 'Margaret'];
  for (let c = 0; c < 5; c++) {
    const h = `g1h${c}`, w = `g1w${c}`;
    addPerson(h, `${names[c * 2]} Alpha`, `182${c}-03-12`, `${1868 + c}-05-01`, 'Aberdare, Wales');
    addPerson(w, `${names[c * 2 + 1]} Alpha`, `182${c}-07-0${c + 1}`, `${1870 + c}-02-01`, 'Aberdare, Wales');
    addPartner(h, w);
    // Each G1 couple has 6 children (big broods), born 1850s.
    for (let k = 0; k < 6; k++) {
      const kid = `g2_${c}_${k}`;
      addPerson(kid, `${names[k]} Beta`, `185${k}-0${(k % 9) + 1}-1${k}`, `${1920 + k}-06-01`, k < 3 ? 'Aberdare, Wales' : 'Cardiff, Wales');
      addParent(h, kid);
      addParent(w, kid);
    }
  }
  // G3: children of the first G2 child of each couple, 3 kids each, born 1890s.
  for (let c = 0; c < 5; c++) {
    const parent = `g2_${c}_0`;
    const spouse = `g2s${c}`;
    addPerson(spouse, `Eleanor Gamma${c}`, `1855-04-0${c + 1}`, `1930-01-01`, 'Cardiff, Wales');
    addPartner(parent, spouse);
    for (let k = 0; k < 3; k++) {
      const kid = `g3_${c}_${k}`;
      addPerson(kid, `${names[k]} Delta`, `189${k}-0${(k % 9) + 1}-2${k}`, `${1970 + k}-03-01`, 'Cardiff, Wales');
      addParent(parent, kid);
      addParent(spouse, kid);
    }
  }
  // G4: living, born 1980s-90s in London. One is a birthday twin of a G1
  // founder (both 12 March — different years, different generations).
  for (let i = 0; i < 12; i++) {
    const id = `g4_${i}`;
    addPerson(id, `${i === 0 ? 'John' : 'Liv'} Epsilon${i}`, i === 0 ? '1985-03-12' : `198${i % 10}-0${(i % 9) + 1}-0${(i % 27) + 1}`.slice(0, 10), null, 'London, England');
    addParent('g3_0_0', id);
  }
  return { people, rels };
}

const { people, rels } = richTree();
const graph = buildGraph(people, rels);
const mods = computeInsightModules(graph, 'g4_0');

// ── Rich tree: everything above threshold lights up ────────────────────────
test('gift of years: 3+ cohorts, rising, gained > 0', () => {
  assert.ok(mods.giftOfYears, 'module should render');
  assert.ok(mods.giftOfYears.cohorts.length >= 3);
  assert.ok(mods.giftOfYears.gained > 0, `gained ${mods.giftOfYears.gained}`);
  // 1820s founders died at ~47; 1890s cohort lived to ~80.
  assert.ok(mods.giftOfYears.first.avg < 60);
  assert.ok(mods.giftOfYears.last.avg > 70);
});

test('fullest year: peak is now (12 living G4 + none earlier concurrent beats them)', () => {
  assert.ok(mods.fullestYear, 'module should render');
  assert.ok(mods.fullestYear.peak.count >= 12);
  assert.equal(mods.fullestYear.series.at(-1).year, new Date().getFullYear());
});

test('strata: 4 generation rows summing to everyone', () => {
  assert.ok(mods.strata, 'module should render');
  assert.equal(mods.strata.rows.length, 4);
  const total = mods.strata.rows.reduce((s, r) => s + r.total, 0);
  assert.equal(total, people.length);
  assert.equal(mods.strata.living + mods.strata.remembered, people.length);
});

test('brood: record household is a 12-child G4 sibling set? no — record needs 2 parents; 6-child G1 couples win', () => {
  assert.ok(mods.brood?.record, 'record should render');
  // g4 kids have only ONE recorded parent (g3_0_0), so they are not a
  // 2-parent household; the 6-child G1 couples hold the record.
  assert.equal(mods.brood.record.count, 6);
});

test('brood: trend falls from G1-era broods toward smaller households', () => {
  assert.ok(mods.brood?.trend, 'trend should render');
  const t = mods.brood.trend;
  assert.ok(t[0].avg > t[t.length - 1].avg, `expected fall, got ${t[0].avg} → ${t[t.length - 1].avg}`);
});

test('names: John leads, thread spans generations', () => {
  assert.ok(mods.names, 'module should render');
  assert.equal(mods.names.top[0].name, 'John');
  assert.ok(mods.names.top[0].count >= 3);
  assert.ok(mods.names.thread.present >= 2);
});

test('heartlands: Aberdare or Cardiff leads; migration steps dedupe consecutively', () => {
  assert.ok(mods.heartlands, 'module should render');
  assert.ok(['Aberdare', 'Cardiff'].includes(mods.heartlands.places[0].display));
  if (mods.heartlands.migration) {
    for (let i = 1; i < mods.heartlands.migration.length; i++) {
      assert.notEqual(mods.heartlands.migration[i].display, mods.heartlands.migration[i - 1].display);
    }
  }
});

test('birthdays: wheel renders; twins are cross-year same-day pairs', () => {
  assert.ok(mods.birthdays, 'module should render');
  assert.equal(mods.birthdays.months.reduce((a, b) => a + b, 0), mods.birthdays.withMonth);
  assert.ok(mods.birthdays.twins.length >= 1, 'the planted 12-March pair should be found');
  const t = mods.birthdays.twins[0];
  assert.equal(t.dateLabel, '12 March');
  assert.notEqual(t.aId, t.bId);
});

// ── Thin tree: thresholds hide everything gracefully ───────────────────────
{
  const thinPeople = [
    { id: 'a', display_name: 'Ann Lee', birth_date: '1950', is_deceased: false },
    { id: 'b', display_name: 'Bob Lee', birth_date: '1948', is_deceased: false },
    { id: 'c', display_name: 'Cal Lee', birth_date: '1980', is_deceased: false },
  ];
  const thinRels = [
    { id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' },
    { id: 'r2', type: 'parent', from_person: 'a', to_person: 'c', qualifier: 'biological' },
    { id: 'r3', type: 'parent', from_person: 'b', to_person: 'c', qualifier: 'biological' },
  ];
  const thin = computeInsightModules(buildGraph(thinPeople, thinRels), 'c');
  test('thin tree: every module hides below threshold (never guesses)', () => {
    assert.equal(thin.giftOfYears, null);
    assert.equal(thin.fullestYear, null);
    assert.equal(thin.strata, null);
    assert.equal(thin.brood, null);
    assert.equal(thin.names, null);
    assert.equal(thin.heartlands, null);
    assert.equal(thin.birthdays, null);
  });
}

// ── Year-only dates: birthday wheel must hide (no months to count) ─────────
{
  const yearOnly = richTree();
  for (const p of yearOnly.people) {
    p.birth_date = p.birth_date ? p.birth_date.slice(0, 4) : p.birth_date;
    if (p.death_date) p.death_date = p.death_date.slice(0, 4);
  }
  const yo = computeInsightModules(buildGraph(yearOnly.people, yearOnly.rels), 'g4_0');
  test('year-only dates: birthday wheel hides, year-based modules survive', () => {
    assert.equal(yo.birthdays, null);
    assert.ok(yo.giftOfYears, 'gift of years only needs years');
    assert.ok(yo.fullestYear, 'fullest year only needs years');
  });
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
