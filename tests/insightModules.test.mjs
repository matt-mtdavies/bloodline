/**
 * Unit tests for lib/insightModules.js — the Wave-1 visual insight modules.
 * Focus: thresholds hide modules on thin data, and the derivations are right
 * on a synthetic tree rich enough to light everything up.
 * Run with: node tests/insightModules.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computeInsightModules, computeThisMonth, buildInsightHighlights } from '../src/lib/insightModules.js';

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
  const addPerson = (id, name, birth, death, place, occupation) => {
    people.push({
      id, display_name: name,
      birth_date: birth, death_date: death || undefined,
      is_deceased: !!death, birth_place: place || '',
      occupation: occupation || '',
    });
  };
  const addParent = (parentId, childId) => {
    rels.push({ id: `r${rid++}`, type: 'parent', from_person: parentId, to_person: childId, qualifier: 'biological' });
  };
  const addPartner = (a, b, marriage_date) => {
    rels.push({
      id: `r${rid++}`, type: 'partner', from_person: a, to_person: b, partner_status: 'current',
      ...(marriage_date ? { is_married: true, marriage_date } : {}),
    });
  };

  // G1: five founding couples born 1820s, died in their 40s-50s.
  // Their children (G2, born 1850s) live to ~70; G3 (1890s) to ~80.
  const names = ['John', 'Margaret', 'John', 'Sarah', 'John', 'Margaret', 'David', 'Sarah', 'David', 'Margaret'];
  for (let c = 0; c < 5; c++) {
    const h = `g1h${c}`, w = `g1w${c}`;
    addPerson(h, `${names[c * 2]} Alpha`, `182${c}-03-12`, `${1868 + c}-05-01`, 'Aberdare, Wales', 'Collier');
    addPerson(w, `${names[c * 2 + 1]} Alpha`, `182${c}-07-0${c + 1}`, `${1870 + c}-02-01`, 'Aberdare, Wales', 'Collier');
    addPartner(h, w);
    // Each G1 couple has 6 children (big broods), born 1850s.
    for (let k = 0; k < 6; k++) {
      const kid = `g2_${c}_${k}`;
      addPerson(kid, `${names[k]} Beta`, `185${k}-0${(k % 9) + 1}-1${k}`, `${1920 + k}-06-01`, k < 3 ? 'Aberdare, Wales' : 'Cardiff, Wales', 'Railwayman');
      addParent(h, kid);
      addParent(w, kid);
    }
  }
  // G3: children of the first G2 child of each couple, 3 kids each, born 1890s.
  // The first G2 couple carries a dated marriage: 1875 → husband's 1920 death,
  // 45 years — the only dated marriage, so the record books' longest.
  // g3_0_0 lives to 1992 so the living G4 kids genuinely overlapped him —
  // that's the middle link of the handshake chain.
  for (let c = 0; c < 5; c++) {
    const parent = `g2_${c}_0`;
    const spouse = `g2s${c}`;
    addPerson(spouse, `Eleanor Gamma${c}`, `1855-04-0${c + 1}`, '1930-01-01', 'Cardiff, Wales', 'Teacher');
    addPartner(parent, spouse, c === 0 ? '1875-06-01' : null);
    for (let k = 0; k < 3; k++) {
      const kid = `g3_${c}_${k}`;
      const death = c === 0 && k === 0 ? '1992-03-01' : `${1970 + k}-03-01`;
      addPerson(kid, `${names[k]} Delta`, `189${k}-0${(k % 9) + 1}-2${k}`, death, 'Cardiff, Wales', 'Nurse');
      addParent(parent, kid);
      addParent(spouse, kid);
    }
  }
  // Chain the five family clusters into one connected tree via G2 marriages —
  // these links are the articulation points the bridges module should find.
  for (let c = 0; c < 4; c++) addPartner(`g2_${c}_1`, `g2_${c + 1}_2`);
  // G4: living, born 1980s-90s in London. One is a birthday twin of a G1
  // founder (both 12 March — different years, different generations).
  for (let i = 0; i < 12; i++) {
    const id = `g4_${i}`;
    addPerson(id, `${i === 0 ? 'John' : 'Liv'} Epsilon${i}`, i === 0 ? '1985-03-12' : `198${i % 10}-0${(i % 9) + 1}-0${(i % 27) + 1}`.slice(0, 10), null, 'London, England', 'Software engineer');
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

// ── Wave 1 interactivity: every bucket keeps the people behind its number ──
test('drill-down: month petals carry their people, tallies match', () => {
  const { months, monthPeople } = mods.birthdays;
  for (let m = 0; m < 12; m++) {
    assert.equal(monthPeople[m].length, months[m], `month ${m} people == tally`);
  }
  // Sorted by day within the month.
  for (const list of monthPeople) {
    for (let i = 1; i < list.length; i++) {
      assert.ok((list[i - 1].day ?? 32) <= (list[i].day ?? 32), 'sorted by day');
    }
  }
});

test('drill-down: sharedDays lists every date 2+ people share, largest first', () => {
  const { sharedDays } = mods.birthdays;
  assert.ok(sharedDays.length >= 1, 'the planted 12 March group exists');
  const march12 = sharedDays.find((g) => g.dateLabel === '12 March');
  assert.ok(march12, '12 March group present');
  assert.ok(march12.ids.length >= 2);
  for (let i = 1; i < sharedDays.length; i++) {
    assert.ok(sharedDays[i - 1].ids.length >= sharedDays[i].ids.length, 'largest group first');
  }
});

test('drill-down: strata rows and heartland places carry ids matching their counts', () => {
  for (const r of mods.strata.rows) assert.equal(r.ids.length, r.total);
  for (const pl of mods.heartlands.places) assert.equal(pl.ids.length, pl.count);
});

test('names: middle names count toward the tally and are tagged; `all` answers any name', () => {
  const people = [
    { id: 'j1', display_name: 'John Doe', birth_date: '1950-01-15' },
    { id: 'j2', display_name: 'John Roe', birth_date: '1960-02-15' },
    { id: 'j3', display_name: 'John Poe', birth_date: '1970-03-15' },
    { id: 'j4', display_name: 'Peter John Smith', birth_date: '1940-04-15' }, // middle John
    { id: 'm1', display_name: 'Mary Doe', birth_date: '1951-05-15' },
    { id: 'm2', display_name: 'Mary Roe', birth_date: '1961-06-15' },
    { id: 'm3', display_name: 'Mary Poe', birth_date: '1971-07-15' },
    { id: 'n1', display_name: 'Kaitlin (Katie) Davies', birth_date: '1990-08-15' }, // nickname skipped
    { id: 'x1', display_name: 'Jason Lone', birth_date: '1995-09-15' }, // below bar threshold
  ];
  const g = buildGraph(people, []);
  const m = computeInsightModules(g, 'j1');
  assert.ok(m.names, 'module renders');
  const john = m.names.all.find((e) => e.name === 'John');
  assert.equal(john.count, 4, 'middle-name John counts');
  assert.equal(john.people.filter((x) => x.middle).length, 1);
  assert.equal(john.people[0].id, 'j4', 'people sorted by birth year (1940 first)');
  // Below-threshold names are still explorable via `all`.
  const jason = m.names.all.find((e) => e.name === 'Jason');
  assert.equal(jason.count, 1);
  // Nickname token "(Katie)" is not a given name; "Kaitlin" is.
  assert.ok(m.names.all.find((e) => e.name === 'Kaitlin'));
  assert.ok(!m.names.all.find((e) => e.name === '(Katie)') && !m.names.all.find((e) => e.name === 'Katie'));
});

// ── Wave 2: handshakes, bridges, records, trades ────────────────────────────
test('handshakes: 3-hop chain from g4_0 back to an 1820 founder', () => {
  assert.ok(mods.handshakes, 'module should render');
  const h = mods.handshakes;
  assert.equal(h.earliestBirth, 1820);
  // Viewer (b.1985) overlaps only g3_0_0 (d.1992); g3_0_0 (b.1890) overlaps
  // the G2 layer; G2 (b.1850s) overlaps the founders — no shortcut exists.
  assert.equal(h.people.length, 4);
  assert.equal(h.hops, 3);
  assert.equal(h.people[h.people.length - 1].id, 'g4_0'); // viewer last
  assert.equal(h.people[0].birth, 1820);                  // earliest first
  for (const link of h.links) assert.ok(link.years >= 1, 'every link is a real overlap');
});

test('bridges: the best split is a mid-chain G2 marriage link (35 vs 36)', () => {
  assert.ok(mods.bridges, 'module should render');
  // Severing either middle chain link splits families {0,1} from {2,3,4} —
  // the most balanced cut available (35/36); outer links leave lopsided cuts.
  assert.ok(['g2_1_1', 'g2_2_2'].includes(mods.bridges.personId), `got ${mods.bridges.personId}`);
  const counts = [mods.bridges.sideA.count, mods.bridges.sideB.count].sort((a, b) => a - b);
  assert.deepEqual(counts, [35, 36]);
});

test('records: 45-year marriage + longest life + most grandchildren', () => {
  assert.ok(mods.records, 'module should render');
  const keys = mods.records.records.map((r) => r.key);
  assert.ok(keys.includes('marriage'));
  const marriage = mods.records.records.find((r) => r.key === 'marriage');
  assert.match(marriage.title, /married 45 years/);
  // Implausible parent ages (g3_0_0 "fathering" at 90+ in this fixture)
  // must be filtered by the sanity window, never crowned a record.
  assert.ok(!keys.includes('oldestParent'));
});

test('trades: eras run from the railway age to Software engineer', () => {
  assert.ok(mods.trades, 'module should render');
  // The first 50-year band contains 10 colliers AND 30 railwaymen — the
  // majority trade of the band leads, not the chronologically first one.
  assert.equal(mods.trades.firstTop, 'Railwayman');
  assert.equal(mods.trades.lastTop, 'Software engineer');
  assert.ok(mods.trades.bands.length >= 2);
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
    assert.equal(thin.handshakes, null, 'chain only 76 years deep — below the 90-year bar');
    assert.equal(thin.bridges, null);
    assert.equal(thin.records, null);
    assert.equal(thin.trades, null);
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

// ── Wave 3: this-month digest + AI-narrative highlights ────────────────────
test('this month: birthdays + anniversaries filtered to the given month, sorted by day', () => {
  const people = [
    { id: 'a', display_name: 'Ann Lee', birth_date: '1950-06-05', is_deceased: false },
    { id: 'b', display_name: 'Bo Lee', birth_date: '1948-06-20', is_deceased: false },
    { id: 'c', display_name: 'Cy Lee', birth_date: '1980-01-01', is_deceased: false }, // wrong month
    { id: 'd', display_name: 'Deceased Lee', birth_date: '1920-06-10', is_deceased: true, death_date: '1990-01-01' },
  ];
  const rels = [
    { id: 'r1', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current', is_married: true, marriage_date: '1975-06-15' },
    { id: 'r2', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' }, // dup edge, no date
  ];
  const g = buildGraph(people, rels);
  const june15 = new Date(2026, 5, 15); // month is 0-indexed in JS Date
  const r = computeThisMonth(g, june15);
  assert.ok(r, 'should render — June has entries');
  assert.equal(r.month, 'June');
  assert.deepEqual(r.birthdays.map((b) => b.id), ['a', 'b']); // deceased excluded, wrong-month excluded, sorted by day
  assert.equal(r.birthdays[0].isToday, false); // Ann's the 5th; "today" is the 15th
  assert.equal(r.anniversaries.length, 1);
  assert.equal(r.anniversaries[0].years, 2026 - 1975);
  assert.equal(r.anniversaries[0].isToday, true);
});

test('this month: null when nothing falls in the given month', () => {
  const people = [{ id: 'a', display_name: 'Ann Lee', birth_date: '1950-06-05', is_deceased: false }];
  const g = buildGraph(people, []);
  const r = computeThisMonth(g, new Date(2026, 0, 15)); // January
  assert.equal(r, null);
});

// January 1st is a very common "I only know the year" placeholder — imported
// trees and this app's own onboarding both default to it. Treated as a real
// date it manufactures a fake spike in "This month" and the birthday wheel.
test('this month: January-1st placeholder dates are excluded; a real Jan-15 birthday still counts', () => {
  const people = [
    { id: 'a', display_name: 'Unknown-Day Lee', birth_date: '1950-01-01', is_deceased: false },
    { id: 'b', display_name: 'Real Birthday Lee', birth_date: '1960-01-15', is_deceased: false },
  ];
  const g = buildGraph(people, []);
  const r = computeThisMonth(g, new Date(2026, 0, 20)); // January
  assert.ok(r, 'should still render — Jan 15 is a real birthday');
  assert.deepEqual(r.birthdays.map((b) => b.id), ['b']);
});

test('birthdays module: January-1st placeholders never inflate the month tally or fake a twin pair', () => {
  const people = [];
  // 20 real February birthdays (comfortably clears both thresholds) plus 10
  // people whose only recorded date is the Jan-1 placeholder.
  for (let i = 0; i < 20; i++) {
    people.push({ id: `feb${i}`, display_name: `Feb Person ${i}`, birth_date: `19${50 + i}-02-1${i % 9}`, is_deceased: false });
  }
  for (let i = 0; i < 10; i++) {
    people.push({ id: `jan1_${i}`, display_name: `Placeholder Person ${i}`, birth_date: `19${60 + i}-01-01`, is_deceased: false });
  }
  const g = buildGraph(people, []);
  const mods2 = computeInsightModules(g, 'feb0');
  assert.ok(mods2.birthdays, 'module should render off the 20 real February dates');
  assert.equal(mods2.birthdays.months[0], 0, 'January bucket must not count the placeholder dates');
  assert.equal(mods2.birthdays.withMonth, 20, 'the 10 placeholder people are excluded entirely');
  assert.equal(mods2.birthdays.peakLabel, 'February');
  // Two placeholder people sharing "Jan 1" must never be reported as birthday twins.
  assert.ok(!mods2.birthdays.twins.some((t) => t.dateLabel === '1 January'), 'no fake January-1st twin pair');
});

test('highlights: pulls a compact digest from whatever modules rendered', () => {
  const h = buildInsightHighlights(mods);
  assert.ok(h.handshake);
  assert.equal(h.handshake.earliestBirth, 1820);
  assert.ok(h.bridge);
  assert.ok(h.longestMarriage);
  assert.match(h.longestMarriage, /45 years/);
});

test('highlights: null when no module rendered anything', () => {
  assert.equal(buildInsightHighlights({}), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
