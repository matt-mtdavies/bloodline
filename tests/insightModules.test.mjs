/**
 * Unit tests for lib/insightModules.js — the Wave-1 visual insight modules.
 * Focus: thresholds hide modules on thin data, and the derivations are right
 * on a synthetic tree rich enough to light everything up.
 * Run with: node tests/insightModules.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computeInsightModules, computeThisMonth, buildInsightHighlights, aliveInYear, handshakesTo, personHighlight, highlightCandidates, pickDailyHighlight, dayIndex, seededShuffle } from '../src/lib/insightModules.js';

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
// records()'s "which 3 of the pool today" rotation depends on the real
// clock by default (see lib/insightModules.js) — pinning `now` to the epoch
// (day 0, divisible by the pool's rotation step) makes the marriage/life/
// grandchildren assertions below deterministic regardless of what day the
// suite actually runs on.
const mods = computeInsightModules(graph, 'g4_0', 0);

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

// ── Wave 2: time-chart drill-downs ──────────────────────────────────────────
test('scrubber: aliveInYear agrees with every point on the computed series', () => {
  const { series, spans } = mods.fullestYear;
  for (const pt of series) {
    assert.equal(aliveInYear(spans, pt.year).length, pt.count, `year ${pt.year}`);
  }
  // Oldest-first ordering, and ageThen is consistent with the span.
  const y = series[Math.floor(series.length / 2)].year;
  const alive = aliveInYear(spans, y);
  for (let i = 1; i < alive.length; i++) {
    assert.ok(alive[i - 1].ageThen >= alive[i].ageThen, 'oldest first');
  }
});

test('gift of years: each cohort carries its people, longest life first', () => {
  for (const c of mods.giftOfYears.cohorts) {
    assert.equal(c.people.length, c.n);
    for (let i = 1; i < c.people.length; i++) {
      assert.ok(c.people[i - 1].span >= c.people[i].span);
    }
    const avg = Math.round(c.people.reduce((s, x) => s + x.span, 0) / c.people.length);
    assert.equal(avg, c.avg, 'avg recomputes from the carried people');
  }
});

// Data-integrity regression: a lifespan computed by insights must match the
// tree's own age display exactly — plain year subtraction overstates a life
// by a year whenever the death fell before that birth-year's anniversary.
// Reported case: Barbara Wagener, b. 1946-xx-xx (day unknown but month
// known), d. 1974, before her birthday that year — the tree said "aged 27",
// insights said "28".
test('gift of years / longest life: precise age, not year subtraction (the Barbara Wagener case)', () => {
  const people = [
    // Born mid-March, died in January — birthday not yet reached: 27, not 28.
    { id: 'bw', display_name: 'Barbara Wagener', birth_date: '1946-03-15', death_date: '1974-01-10', is_deceased: true },
    // Three padding lives in the same decade so the 1940s cohort clears its
    // own n>=4 bar, plus two more full decades so the module clears its
    // separate "at least 3 decade rows" bar.
    { id: 'p1', display_name: 'Pad One', birth_date: '1946-05-01', death_date: '2000-05-01', is_deceased: true },
    { id: 'p2', display_name: 'Pad Two', birth_date: '1947-05-01', death_date: '2001-05-01', is_deceased: true },
    { id: 'p3', display_name: 'Pad Three', birth_date: '1948-05-01', death_date: '2002-05-01', is_deceased: true },
    { id: 'p4', display_name: 'Pad Four', birth_date: '1950-05-01', death_date: '2010-05-01', is_deceased: true },
    { id: 'p5', display_name: 'Pad Five', birth_date: '1951-05-01', death_date: '2011-05-01', is_deceased: true },
    { id: 'p6', display_name: 'Pad Six', birth_date: '1952-05-01', death_date: '2012-05-01', is_deceased: true },
    { id: 'p7', display_name: 'Pad Seven', birth_date: '1953-05-01', death_date: '2013-05-01', is_deceased: true },
    { id: 'p8', display_name: 'Pad Eight', birth_date: '1960-05-01', death_date: '2020-05-01', is_deceased: true },
    { id: 'p9', display_name: 'Pad Nine', birth_date: '1961-05-01', death_date: '2021-05-01', is_deceased: true },
    { id: 'p10', display_name: 'Pad Ten', birth_date: '1962-05-01', death_date: '2022-05-01', is_deceased: true },
    { id: 'p11', display_name: 'Pad Eleven', birth_date: '1963-05-01', death_date: '2023-05-01', is_deceased: true },
  ];
  const g = buildGraph(people, []);
  const m = computeInsightModules(g, 'p1');
  assert.ok(m.giftOfYears, 'module should render');
  const cohort = m.giftOfYears.cohorts.find((c) => c.decade === 1940);
  const bw = cohort.people.find((x) => x.id === 'bw');
  assert.equal(bw.span, 27, 'died before her March birthday in 1974 — 27, not 28');

  // records' own "longest life" record needs a life of 85+ to qualify, which
  // this fixture deliberately doesn't have — giftOfYears above is the
  // primary check. Where records DOES render (see the richTree suite below),
  // its board is checked the same way.
});

test('brood: each trend bucket carries its households, fullest first', () => {
  for (const t of mods.brood.trend) {
    assert.equal(t.households.length, t.n);
    for (let i = 1; i < t.households.length; i++) {
      assert.ok(t.households[i - 1].count >= t.households[i].count);
    }
  }
});

test('trades: every band tag carries exactly its people', () => {
  for (const b of mods.trades.bands) {
    for (const t of b.top) assert.equal(t.ids.length, t.count);
  }
});

test('records: leaderboards are capped at 5, sorted, and led by the headline holder', () => {
  // Recompute the full pool via a fresh call — `records` rotates its shown
  // three daily, so check whichever are shown.
  for (const r of mods.records.records) {
    assert.ok(Array.isArray(r.board) && r.board.length >= 1 && r.board.length <= 5, `${r.key} board`);
    assert.equal(r.board[0].id, r.personId, `${r.key} board led by the holder`);
    for (const row of r.board) assert.ok(row.id && row.detail, 'row has id + detail');
  }
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

// A middle name often lives in its OWN field, never spelled out in
// display_name — the profile heading weaves person.middle_name in only for
// that one view (fullName() in lib/profile.js: "Sari Stein" the record,
// "Sari Heather Stein" the heading). The tally must count it either way.
test('names: a middle_name field counts even when display_name never spells it out', () => {
  const people = [
    { id: 's1', display_name: 'Sari Stein', middle_name: 'Heather', birth_date: '1980-01-01' },
    { id: 'h1', display_name: 'Heather Davies', birth_date: '1959-01-01' },
    { id: 'h2', display_name: 'Heather Lone', birth_date: '1965-01-01' },
    // middle_name already spelled out in display_name — must not double-count.
    { id: 'j1', display_name: 'Peter John Smith', middle_name: 'John', birth_date: '1940-01-01' },
    // Padding so a second name also clears the module's own >=3 bar-chart
    // threshold — irrelevant to what's under test, which is `all`.
    { id: 'j2', display_name: 'John Roe', birth_date: '1961-01-01' },
    { id: 'j3', display_name: 'John Poe', birth_date: '1971-01-01' },
  ];
  const g = buildGraph(people, []);
  const m = computeInsightModules(g, 'h1');
  assert.ok(m.names, 'module renders');
  const heather = m.names.all.find((e) => e.name === 'Heather');
  assert.equal(heather.count, 3, 'Sari (middle_name), Heather Davies, Heather Lone');
  assert.ok(heather.people.find((x) => x.id === 's1' && x.middle), 'Sari counted via middle_name, tagged middle');
  const john = m.names.all.find((e) => e.name === 'John');
  assert.equal(john.count, 3, 'Peter (middle_name, not double-counted) + John Roe + John Poe');
  assert.equal(john.people.filter((x) => x.id === 'j1').length, 1, 'Peter appears once, not twice');
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

test('handshakes: never links two ancestors from different branches, even if their lifespans overlap', () => {
  // v's paternal line: ff (1700-1750) is old enough and deep enough to be a
  // tempting target. v's maternal line: mm (1745-1795) overlaps ff's window
  // by 5 years — but mm is not ff's relative; they share no ancestor of each
  // other, only a common descendant (v) several generations later. The old
  // algorithm treated any two overlapping ancestors as linkable and would
  // have chained v -> m -> mm -> ff straight across branches. Neither real
  // line (v-f-ff, v-m-mm) has an unbroken overlap on its own — f (b.1960)
  // never overlaps ff (d.1750), and m (b.1962) never overlaps mm (d.1795) —
  // so the fix must return null rather than smuggle the cross-branch link in.
  const people = [
    { id: 'v', display_name: 'Vera', birth_date: '1990-01-01', is_deceased: false },
    { id: 'f', display_name: 'Fred', birth_date: '1960-01-01', is_deceased: false },
    { id: 'm', display_name: 'Mary', birth_date: '1962-01-01', is_deceased: false },
    { id: 'ff', display_name: 'Fred Sr', birth_date: '1700-01-01', death_date: '1750-01-01', is_deceased: true },
    { id: 'mm', display_name: 'Martha', birth_date: '1745-01-01', death_date: '1795-01-01', is_deceased: true },
  ];
  const rels = [
    { id: 'r1', type: 'parent', from_person: 'f', to_person: 'v', qualifier: 'biological' },
    { id: 'r2', type: 'parent', from_person: 'm', to_person: 'v', qualifier: 'biological' },
    { id: 'r3', type: 'parent', from_person: 'ff', to_person: 'f', qualifier: 'biological' },
    { id: 'r4', type: 'parent', from_person: 'mm', to_person: 'm', qualifier: 'biological' },
  ];
  const g = buildGraph(people, rels);
  const r = computeInsightModules(g, 'v').handshakes;
  assert.equal(r, null, 'no unbroken single-line chain exists — a cross-branch shortcut would wrongly return one');
});

test('handshakes: a step-parent\'s own ancestors are never treated as bloodline', () => {
  // v's only bio parent (f, b.1960) is too shallow to clear the 90-year bar
  // on its own. v also has a step-parent (s, b.1780) whose own bio parent
  // (ss, b.1700-1800) overlaps s by 20 years, and s in turn overlaps v — a
  // fully unbroken chain v -> s -> ss that would satisfy every check *if*
  // step edges counted as ancestry. graph.parents() returns step edges
  // alongside biological ones (it's qualifier-agnostic), so the walk must
  // explicitly skip qualifier 'step' or it would wrongly crown ss the
  // viewer's "three handshakes from 1700" ancestor.
  const people = [
    { id: 'v', display_name: 'Vera', birth_date: '1990-01-01', is_deceased: false },
    { id: 'f', display_name: 'Fred', birth_date: '1960-01-01', is_deceased: false },
    { id: 's', display_name: 'Steve', birth_date: '1780-01-01', is_deceased: false },
    { id: 'ss', display_name: 'Steve Sr', birth_date: '1700-01-01', death_date: '1800-01-01', is_deceased: true },
  ];
  const rels = [
    { id: 'r1', type: 'parent', from_person: 'f', to_person: 'v', qualifier: 'biological' },
    { id: 'r2', type: 'parent', from_person: 's', to_person: 'v', qualifier: 'step' },
    { id: 'r3', type: 'parent', from_person: 'ss', to_person: 's', qualifier: 'biological' },
  ];
  const g = buildGraph(people, rels);
  const r = computeInsightModules(g, 'v').handshakes;
  assert.equal(r, null, 'the only real ancestor line (f, b.1960) is too shallow — a step-line chain to ss must not substitute');
});

// ── Wave 3: handshakes to anyone ─────────────────────────────────────────────
test('handshakesTo: direct parent/child overlap is a single hop, target first, viewer last', () => {
  const r = handshakesTo(graph, 'g4_0', 'g3_0_0');
  assert.ok(r, 'g3_0_0 directly overlapped g4_0\'s early years');
  assert.equal(r.hops, 1);
  assert.equal(r.people.length, 2);
  assert.equal(r.people[0].id, 'g3_0_0');
  assert.equal(r.people[r.people.length - 1].id, 'g4_0');
});

test('handshakesTo: reaches the same 1820 founder the deep-time default finds, in no more hops', () => {
  const founderId = mods.handshakes.people[0].id;
  const r = handshakesTo(graph, 'g4_0', founderId);
  assert.ok(r, 'a chain to the default\'s own target must exist');
  assert.equal(r.people[0].id, founderId);
  assert.equal(r.people[r.people.length - 1].id, 'g4_0');
  assert.ok(r.hops <= mods.handshakes.hops, 'searching the whole tree can only match or beat the ancestor-only path');
});

test('handshakesTo: same person, or a person with no decidable dates, returns null', () => {
  assert.equal(handshakesTo(graph, 'g4_0', 'g4_0'), null);
  const ghostPeople = [...people, { id: 'ghost', display_name: 'No Dates' }];
  const ghostGraph = buildGraph(ghostPeople, rels);
  assert.equal(handshakesTo(ghostGraph, 'g4_0', 'ghost'), null);
});

test('handshakesTo: two people in disconnected, non-overlapping fragments find no chain', () => {
  const isolated = [
    ...people,
    { id: 'iso1', display_name: 'Iso One', birth_date: '1400-01-01', death_date: '1450-01-01', is_deceased: true },
  ];
  const isoGraph = buildGraph(isolated, rels); // no relationship links iso1 to anyone
  assert.equal(handshakesTo(isoGraph, 'g4_0', 'iso1'), null);
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
  assert.equal(r.birthdays[0].isPast, true); // her birthday already happened this month
  assert.equal(r.birthdays[1].isPast, false); // Bo's the 20th — still upcoming
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

// ── Wave 4: parenthood age, partner age-gap record, never-met ──────────────
// records() only renders once its pool holds 2+ qualifying entries (never a
// single lonely stat), so every fixture below plants one extra long marriage
// alongside the thing actually under test to clear that floor honestly.
let wid = 0;
function pRel(parentId, childId, qualifier = 'biological') {
  return { id: `w${wid++}`, type: 'parent', from_person: parentId, to_person: childId, qualifier };
}
function uRel(a, b, marriageDate = null) {
  return {
    id: `w${wid++}`, type: 'partner', from_person: a, to_person: b, partner_status: 'current',
    ...(marriageDate ? { is_married: true, marriage_date: marriageDate } : {}),
  };
}

test('parenthood: average, range and gender split over 8+ recorded births', () => {
  const people = [];
  const rels = [];
  const ages = [20, 22, 24, 26, 28, 30, 32, 34]; // avg 27
  ages.forEach((age, i) => {
    const parentId = `par${i}`, childId = `kid${i}`;
    people.push({ id: parentId, display_name: `Parent${i}`, birth_date: '1970-01-01', gender: i % 2 === 0 ? 'female' : 'male' });
    people.push({ id: childId, display_name: `Kid${i}`, birth_date: `${1970 + age}-01-01` });
    rels.push(pRel(parentId, childId));
  });
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'par0');
  assert.ok(mods.parenthood, 'module should render at 8 samples');
  assert.equal(mods.parenthood.avg, 27);
  assert.equal(mods.parenthood.min, 20);
  assert.equal(mods.parenthood.max, 34);
  assert.equal(mods.parenthood.n, 8);
  assert.ok(mods.parenthood.byGender.female, 'female parents split out (4 samples)');
  assert.ok(mods.parenthood.byGender.male, 'male parents split out (4 samples)');
  const total = mods.parenthood.histogram.reduce((s, b) => s + b.count, 0);
  assert.equal(total, 8, 'histogram buckets account for every sample');
});

test('parenthood: hides below the 8-sample threshold', () => {
  const people = [];
  const rels = [];
  for (let i = 0; i < 5; i++) {
    people.push({ id: `p${i}`, display_name: `Parent${i}`, birth_date: '1970-01-01' });
    people.push({ id: `c${i}`, display_name: `Kid${i}`, birth_date: '1998-01-01' });
    rels.push(pRel(`p${i}`, `c${i}`));
  }
  const graph = buildGraph(people, rels);
  assert.equal(computeInsightModules(graph, 'p0').parenthood, null);
});

test('records: widest partner age gap is surfaced with a 5-deep leaderboard', () => {
  const people = [
    { id: 'a1', display_name: 'Old One', birth_date: '1930-01-01' },
    { id: 'b1', display_name: 'Young One', birth_date: '1955-01-01' }, // 25 yrs
    { id: 'a2', display_name: 'Close A', birth_date: '1940-01-01' },
    { id: 'b2', display_name: 'Close B', birth_date: '1942-01-01' }, // 2 yrs — below the 10-yr floor
    // An unrelated long marriage, just to clear records()'s "2+ pool entries" floor.
    { id: 'm1', display_name: 'Married One', birth_date: '1900-01-01' },
    { id: 'm2', display_name: 'Married Two', birth_date: '1902-01-01' },
  ];
  const rels = [uRel('a1', 'b1'), uRel('a2', 'b2'), uRel('m1', 'm2', '1930-01-01')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'a1');
  const entry = mods.records?.records?.find((r) => r.key === 'ageGap');
  assert.ok(entry, 'expected an ageGap record from the 25-year pair');
  assert.equal(entry.title, '25-year age gap');
  assert.equal(entry.personId, 'a1');
});

test('records: no ageGap record when every partner pair is within the 10-year floor', () => {
  const people = [
    { id: 'a', display_name: 'A', birth_date: '1940-01-01' },
    { id: 'b', display_name: 'B', birth_date: '1945-01-01' }, // 5 yrs
  ];
  const rels = [uRel('a', 'b')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'a');
  const entry = mods.records?.records?.find((r) => r.key === 'ageGap');
  assert.equal(entry, undefined);
});

test('records: a grandchild born after a grandparent died surfaces as "never met"', () => {
  const people = [
    { id: 'gp1', display_name: 'Grandpa Old', birth_date: '1900-01-01', is_deceased: true, death_date: '1960-01-01' },
    { id: 'gp2', display_name: 'Grandma Old', birth_date: '1902-01-01', is_deceased: true, death_date: '1961-01-01' },
    { id: 'parent', display_name: 'Middle Gen', birth_date: '1930-01-01' },
    { id: 'grandkid', display_name: 'The Grandkid', birth_date: '1972-01-01' }, // 12 yrs after gp1 died
    // Two more never-met pairs elsewhere in the tree, to clear the "3+ instances" floor.
    { id: 'gp3', display_name: 'Great Aunt Old', birth_date: '1898-01-01', is_deceased: true, death_date: '1955-01-01' },
    { id: 'parent2', display_name: 'Cousin Parent', birth_date: '1928-01-01' },
    { id: 'cousin', display_name: 'A Cousin', birth_date: '1970-01-01' },
    { id: 'gp4', display_name: 'Uncle Old', birth_date: '1897-01-01', is_deceased: true, death_date: '1950-01-01' },
    { id: 'parent3', display_name: 'Third Parent', birth_date: '1925-01-01' },
    { id: 'third', display_name: 'Third Grandkid', birth_date: '1965-01-01' },
  ];
  const rels = [
    pRel('gp1', 'parent'), pRel('gp2', 'parent'), pRel('parent', 'grandkid'),
    pRel('gp3', 'parent2'), pRel('parent2', 'cousin'),
    pRel('gp4', 'parent3'), pRel('parent3', 'third'),
    // gp1 & gp2's own long marriage, just to clear records()'s "2+ pool entries" floor.
    uRel('gp1', 'gp2', '1925-01-01'),
  ];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'grandkid');
  const entry = mods.records?.records?.find((r) => r.key === 'neverMet');
  assert.ok(entry, 'expected a neverMet record with 3+ instances');
  assert.match(entry.detail, /3 grandchildren/);
});

test('records: a lone never-met pair (below the 3-instance floor) does not surface', () => {
  const people = [
    { id: 'gp', display_name: 'Grandpa', birth_date: '1900-01-01', is_deceased: true, death_date: '1960-01-01' },
    { id: 'parent', display_name: 'Parent', birth_date: '1930-01-01' },
    { id: 'grandkid', display_name: 'Grandkid', birth_date: '1972-01-01' },
  ];
  const rels = [pRel('gp', 'parent'), pRel('parent', 'grandkid')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'grandkid');
  const entry = mods.records?.records?.find((r) => r.key === 'neverMet');
  assert.equal(entry, undefined);
});

// ── personHighlight: the tree screen's per-person fact (nav brief: "surface
//    one real insight from the tree screen itself") ────────────────────────
test('personHighlight: null for the viewer themselves', () => {
  assert.equal(personHighlight(graph, 'g4_0', 'g4_0', mods), null);
});

test('personHighlight: birthday twin — names the OTHER person, regardless of which side is asked about', () => {
  const twin = mods.birthdays.twins[0];
  assert.ok(twin, 'fixture sanity: the cross-generation birthday twin should exist');
  for (const [targetId, otherName] of [[twin.aId, twin.bName], [twin.bId, twin.aName]]) {
    const fact = personHighlight(graph, 'g3_0_0', targetId, mods);
    assert.ok(fact?.startsWith('Shares a birthday with'), `expected a birthday-twin fact, got: ${fact}`);
    assert.ok(fact.includes(otherName), `expected "${otherName}" in: ${fact}`);
  }
});

test('personHighlight: record holder — returns that record\'s own headline, not a generic line', () => {
  const rec = mods.records.pool.find((r) => r.key === 'life');
  assert.ok(rec, 'fixture sanity: a "longest life" record should exist');
  assert.equal(personHighlight(graph, 'g4_0', rec.personId, mods), rec.title);
});

test('personHighlight: falls back to a handshake fact once a target holds no twin/record fact', () => {
  const excluded = new Set([
    'g4_0',
    ...mods.records.pool.map((r) => r.personId),
    ...mods.birthdays.twins.flatMap((t) => [t.aId, t.bId]),
  ]);
  const candidate = graph.people.find(
    (p) => !excluded.has(p.id) && (handshakesTo(graph, 'g4_0', p.id)?.hops ?? 0) >= 2,
  );
  assert.ok(candidate, 'fixture sanity: some non-record, non-twin person should be a multi-hop chain away');
  const fact = personHighlight(graph, 'g4_0', candidate.id, mods);
  assert.ok(fact?.startsWith("You're ") && fact.includes('handshakes from'), `expected a handshake fact, got: ${fact}`);
});

test('personHighlight: null for a merely one-hop relative — true, but not a "fact"', () => {
  // Siblings, both living — a direct overlap edge, hops === 1. Not surprising
  // enough to be worth a sentence, so this should stay quiet rather than say
  // "you're 1 handshake from your own brother."
  assert.equal(handshakesTo(graph, 'g4_0', 'g4_1')?.hops, 1);
  assert.equal(personHighlight(graph, 'g4_0', 'g4_1', mods), null);
});

// ── Service records ─────────────────────────────────────────────────────────
// Small standalone trees — military-tagged life events, not richTree scale.

test('serviceRecords: a single military-tagged event is enough to surface (provenance, not a pattern)', () => {
  const people = [{
    id: 'a', display_name: 'Herbert Davies',
    events: [{ year: '1942', title: 'Enlisted', detail: 'VX27390', tag: 'military' }],
  }];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.ok(serviceRecords, 'expected a serviceRecords module with one documented record');
  assert.equal(serviceRecords.count, 1);
  assert.equal(serviceRecords.people[0].id, 'a');
  assert.equal(serviceRecords.people[0].events[0].title, 'Enlisted');
});

test('serviceRecords: events are sorted chronologically within a person', () => {
  const people = [{
    id: 'a', display_name: 'Herbert Davies',
    events: [
      { year: '1945', title: 'Discharged', tag: 'military' },
      { year: '1942', title: 'Enlisted', tag: 'military' },
    ],
  }];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.deepEqual(serviceRecords.people[0].events.map((e) => e.title), ['Enlisted', 'Discharged']);
});

test('serviceRecords: non-military life events are excluded', () => {
  const people = [{
    id: 'a', display_name: 'Jane Doe',
    events: [{ year: '1975', title: 'Married' }],
  }];
  const graph = buildGraph(people, []);
  assert.equal(computeInsightModules(graph, 'a').serviceRecords, null);
});

test('serviceRecords: null when nobody in the tree has a military-tagged event', () => {
  const people = [{ id: 'a', display_name: 'Jane Doe' }];
  const graph = buildGraph(people, []);
  assert.equal(computeInsightModules(graph, 'a').serviceRecords, null);
});

test('serviceRecords: a person with only a branch (no events) still surfaces', () => {
  const people = [{ id: 'a', display_name: 'James Mercer', military_branch: 'navy' }];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.ok(serviceRecords);
  assert.equal(serviceRecords.count, 1);
  assert.equal(serviceRecords.people[0].events.length, 0);
  assert.equal(serviceRecords.people[0].branch, 'navy');
});

test('serviceRecords: a person with only a medal (no events, no branch) still surfaces', () => {
  const people = [{ id: 'a', display_name: 'James Mercer', military_medals: [{ name: 'Military Medal' }] }];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.ok(serviceRecords);
  assert.equal(serviceRecords.people[0].medals, 1);
});

test('serviceRecords: branchCounts tallies by branch, unspecified counted separately', () => {
  const people = [
    { id: 'a', display_name: 'A', military_branch: 'army' },
    { id: 'b', display_name: 'B', military_branch: 'army' },
    { id: 'c', display_name: 'C', military_branch: 'navy' },
    { id: 'd', display_name: 'D', events: [{ year: '1940', title: 'Enlisted', tag: 'military' }] },
  ];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.deepEqual(serviceRecords.branchCounts, { army: 2, navy: 1, unspecified: 1 });
});

test('serviceRecords: medalTotal sums medals across every documented relative', () => {
  const people = [
    { id: 'a', display_name: 'A', military_medals: [{ name: 'Military Medal' }, { name: 'Star' }] },
    { id: 'b', display_name: 'B', military_medals: [{ name: 'Long Service Medal' }] },
    { id: 'c', display_name: 'C', military_branch: 'army' },
  ];
  const graph = buildGraph(people, []);
  const { serviceRecords } = computeInsightModules(graph, 'a');
  assert.equal(serviceRecords.medalTotal, 3);
});

test('serviceRecords: generationsSpanned counts distinct generations among documented relatives', () => {
  const people = [
    { id: 'gp', display_name: 'Grandparent', military_branch: 'army' },
    { id: 'parent', display_name: 'Parent' },
    { id: 'child', display_name: 'Child', military_branch: 'navy' },
  ];
  const rels = [
    { id: 'r1', type: 'parent', from_person: 'gp', to_person: 'parent', qualifier: 'biological' },
    { id: 'r2', type: 'parent', from_person: 'parent', to_person: 'child', qualifier: 'biological' },
  ];
  const graph = buildGraph(people, rels);
  const { serviceRecords } = computeInsightModules(graph, 'gp');
  assert.equal(serviceRecords.count, 2);
  assert.equal(serviceRecords.generationsSpanned, 2);
});

// ── Data-quality: punctuation/whitespace-only duplicates merge ─────────────
// "Mt. Gambier" and "Mt Gambier" are the same town typed two ways — a raw
// lowercase key used to treat them as two different places, silently
// splitting one true count across two bars (reported live: 14 + 10 shown
// separately instead of 24 together).

test('heartlands: "Mt. Gambier" and "Mt Gambier" merge into one place, showing the more common spelling', () => {
  const people = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, display_name: `A${i}`, birth_place: 'Mt. Gambier' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, display_name: `B${i}`, birth_place: 'Mt Gambier' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, display_name: `C${i}`, birth_place: 'Adelaide' })),
  ];
  const graph = buildGraph(people, []);
  const { heartlands } = computeInsightModules(graph, 'a0');
  assert.ok(heartlands, 'module should render');
  const gambierEntries = heartlands.places.filter((p) => /gambier/i.test(p.display));
  assert.equal(gambierEntries.length, 1, 'the two spellings should merge into a single place entry');
  assert.equal(gambierEntries[0].display, 'Mt. Gambier', 'the more common spelling (5 vs 3) should be shown');
  assert.equal(gambierEntries[0].count, 8);
  assert.equal(gambierEntries[0].ids.length, 8);
});

test('trades: punctuation-only occupation variants merge into one tally, keyed by the more common spelling', () => {
  const { people: p2, rels: r2 } = richTree();
  const railwaymen = p2.filter((p) => p.occupation === 'Railwayman');
  assert.ok(railwaymen.length >= 4, 'fixture should have enough railwaymen to test with');
  railwaymen.slice(0, 2).forEach((p) => { p.occupation = 'Railwayman.'; }); // trailing period, same job
  const g2 = buildGraph(p2, r2);
  const trades = computeInsightModules(g2, 'g4_0', 0).trades;
  assert.ok(trades, 'module should still render');
  const firstBand = trades.bands[0];
  const railwaymanEntries = firstBand.top.filter((t) => t.name.replace(/\.$/, '') === 'Railwayman');
  assert.equal(railwaymanEntries.length, 1, 'the two spellings should merge into a single entry');
  assert.equal(railwaymanEntries[0].count, railwaymen.length, 'the merged entry should carry the combined count');
});

// ── trades: the explorer's `all` list (search any trade, not just an era's top 3) ─

test("trades: `all` lists every distinct trade in the family, not just each era's top 3", () => {
  const trades = mods.trades;
  assert.ok(trades, 'module should render for the rich fixture');
  const names = trades.all.map((e) => e.name).sort();
  assert.deepEqual(names, ['Collier', 'Nurse', 'Railwayman', 'Software engineer', 'Teacher']);
  assert.equal(trades.all.length, trades.distinct, '`all` should have exactly one entry per distinct trade');
  const railwayman = trades.all.find((e) => e.name === 'Railwayman');
  assert.equal(railwayman.count, 30);
  assert.equal(railwayman.ids.length, 30);
});

test('trades: `all` is sorted by count descending, alphabetical tiebreak', () => {
  const counts = mods.trades.all.map((e) => e.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'entries should already be sorted by count descending');
});

test('trades: `all` merges punctuation-only variants, same fix as the per-band top list', () => {
  const { people: p2, rels: r2 } = richTree();
  const railwaymen = p2.filter((p) => p.occupation === 'Railwayman');
  railwaymen.slice(0, 2).forEach((p) => { p.occupation = 'Railwayman.'; });
  const g2 = buildGraph(p2, r2);
  const trades = computeInsightModules(g2, 'g4_0', 0).trades;
  const railwaymanEntries = trades.all.filter((e) => e.name.replace(/\.$/, '') === 'Railwayman');
  assert.equal(railwaymanEntries.length, 1, 'the two spellings should merge into a single entry');
  assert.equal(railwaymanEntries[0].count, railwaymen.length);
});

// ── highlightCandidates / pickDailyHighlight: the "insight spotlight" pool ─
// (IdleFactHint on the tree screen, the home hub's "did you know" teaser)

test('highlightCandidates: null/empty modules produce an empty pool, never throw', () => {
  assert.deepEqual(highlightCandidates(null), []);
  assert.deepEqual(highlightCandidates({}), []);
});

test('highlightCandidates: every populated module in the rich fixture contributes exactly one sentence', () => {
  const candidates = highlightCandidates(mods);
  // The rich fixture lights up every module except serviceRecords (no
  // military data), livingGenerations (only G4 is alive — one generation,
  // not three), twinBirths (needs 2+ sets, the fixture only ever produces
  // one) and tradeLineage/newArrivals/blendedFamily/earlyLoss (no matching
  // data at all) — but surnames DOES qualify: "Alpha"/"Beta"/"Delta" each
  // appear 10+ times across the fixture's generations, an incidental side
  // effect of richTree()'s naming scheme, not something deliberately
  // engineered in. centenarians ALSO incidentally qualifies: g3_0_0's own
  // 1890 birth to a deliberately-set 1992 death (see richTree()'s own
  // comment on that date, planted for the handshake-chain test) happens to
  // land at age 102 — 14 of the 21 possible candidates.
  assert.equal(candidates.length, 14);
  assert.ok(candidates.every((c) => typeof c === 'string' && c.length > 0));
});

test('highlightCandidates: handshakes phrases as "N handshakes from {firstName}, born in {year}"', () => {
  const candidates = highlightCandidates(mods);
  const h = mods.handshakes;
  const expected = `You're only ${h.hops} handshakes from ${h.people[0].firstName}, born in ${h.people[0].birth}.`;
  assert.ok(candidates.includes(expected), `expected to find: ${expected}`);
});

test('highlightCandidates: strata phrases as "N generations — X living, Y remembered"', () => {
  const candidates = highlightCandidates(mods);
  const s = mods.strata;
  const expected = `The family tree spans ${s.rows.length} generations — ${s.living} living, ${s.remembered} remembered.`;
  assert.ok(candidates.includes(expected));
});

test('highlightCandidates: fullestYear phrases as "N members alive at once in YEAR"', () => {
  const candidates = highlightCandidates(mods);
  const p = mods.fullestYear.peak;
  const expected = `${p.count} family members were alive at the same time in ${p.year} — the fullest year on record.`;
  assert.ok(candidates.includes(expected));
});

test('highlightCandidates: brood phrases the record household with its span', () => {
  const candidates = highlightCandidates(mods);
  const r = mods.brood.record;
  const expected = `${r.parentNames.join(' & ')} raised the family's biggest household — ${r.count} children${r.span ? ` between ${r.span}` : ''}.`;
  assert.ok(candidates.includes(expected));
});

test('highlightCandidates: brood contributes nothing when there is no record household', () => {
  const candidates = highlightCandidates({ brood: { record: null, trend: [{}] } });
  assert.ok(!candidates.some((c) => c.includes('biggest household')));
});

test('highlightCandidates: serviceRecords phrases count + generations, singular/plural correctly', () => {
  const one = highlightCandidates({ serviceRecords: { count: 1, generationsSpanned: 1 } });
  assert.deepEqual(one, ['1 family member has a documented military service record, spanning 1 generation.']);
  const many = highlightCandidates({ serviceRecords: { count: 3, generationsSpanned: 2 } });
  assert.deepEqual(many, ['3 family members have a documented military service record, spanning 2 generations.']);
});

test('highlightCandidates: handshakes is absent (not crashing) when computed without a viewer, but strata still renders', () => {
  // Mirrors the home hub's own call site: computeInsightModules(graph, null).
  const homeHubMods = computeInsightModules(graph, null);
  assert.equal(homeHubMods.handshakes, null, 'handshakes has no meaning without a viewer');
  assert.ok(homeHubMods.strata, 'strata is tree-wide, not viewer-specific — should still render');
  const candidates = highlightCandidates(homeHubMods);
  assert.ok(!candidates.some((c) => c.includes('handshake')));
  assert.ok(candidates.some((c) => c.includes('generations —')), 'strata\'s candidate should still be offered');
});

test('pickDailyHighlight: always returns one of highlightCandidates\' own sentences', () => {
  const candidates = highlightCandidates(mods);
  const picked = pickDailyHighlight(mods);
  assert.ok(candidates.includes(picked));
});

test('pickDailyHighlight: null when nothing qualifies', () => {
  assert.equal(pickDailyHighlight({}), null);
  assert.equal(pickDailyHighlight(null), null);
});

// ── dayIndex / seededShuffle — the Insights sheet's per-day reorder ─────────

test('dayIndex: same calendar day always gives the same index', () => {
  const morning = new Date('2026-03-14T02:00:00Z').getTime();
  const evening = new Date('2026-03-14T23:00:00Z').getTime();
  assert.equal(dayIndex(morning), dayIndex(evening));
});

test('dayIndex: a different day gives a different index', () => {
  const day1 = new Date('2026-03-14T12:00:00Z').getTime();
  const day2 = new Date('2026-03-15T12:00:00Z').getTime();
  assert.notEqual(dayIndex(day1), dayIndex(day2));
});

test('seededShuffle: same seed always produces the same order', () => {
  const arr = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(seededShuffle(arr, 42), seededShuffle(arr, 42));
});

test('seededShuffle: different seeds usually produce different orders', () => {
  const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const orders = new Set([1, 2, 3, 4, 5].map((seed) => seededShuffle(arr, seed).join('')));
  assert.ok(orders.size > 1, 'five different seeds should not all collapse to one order');
});

test('seededShuffle: never drops, duplicates, or invents an element', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const shuffled = seededShuffle(arr, 7);
  assert.deepEqual([...shuffled].sort(), [...arr].sort());
});

test('seededShuffle: does not mutate the input array', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const copy = [...arr];
  seededShuffle(arr, 99);
  assert.deepEqual(arr, copy);
});

// ── The module catalogue expansion: surnames, livingGenerations,
//    twinBirths, newArrivals, blendedFamily, tradeLineage, earlyLoss,
//    centenarians. ──────────────────────────────────────────────────────

test('surnames: ranks families by size and hides below the 2-surname threshold', () => {
  const people = [];
  const rels = [];
  for (let i = 0; i < 5; i++) people.push({ id: `d${i}`, display_name: `Person${i} Davies`, birth_date: `${1950 + i}-01-01` });
  for (let i = 0; i < 3; i++) people.push({ id: `s${i}`, display_name: `Person${i} Smith`, birth_date: `${1950 + i}-01-01` });
  people.push({ id: 'x0', display_name: 'Person Xu', birth_date: '1950-01-01' }); // only 1 — below threshold, excluded from top
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'd0');
  assert.ok(mods.surnames, 'module should render with 2 qualifying surnames');
  assert.equal(mods.surnames.top[0].name, 'Davies');
  assert.equal(mods.surnames.top[0].count, 5);
  assert.equal(mods.surnames.top[1].name, 'Smith');
  assert.ok(!mods.surnames.top.find((e) => e.name === 'Xu'), 'a lone surname stays below the count-3 floor');

  const thin = buildGraph([{ id: 'a', display_name: 'Solo Alpha', birth_date: '1950-01-01' }], []);
  assert.equal(computeInsightModules(thin, 'a').surnames, null);
});

test('livingGenerations: counts only the living, across 3+ generations', () => {
  const people = [
    { id: 'g1', display_name: 'Grandparent', birth_date: '1930-01-01' }, // living
    { id: 'p1', display_name: 'Parent', birth_date: '1955-01-01' }, // living
    { id: 'c1', display_name: 'Child', birth_date: '1980-01-01' }, // living
    { id: 'd1', display_name: 'Deceased Great', birth_date: '1900-01-01', death_date: '1960-01-01', is_deceased: true },
  ];
  const rels = [pRel('d1', 'g1'), pRel('g1', 'p1'), pRel('p1', 'c1')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'c1');
  assert.ok(mods.livingGenerations, 'module should render across 3 living generations');
  assert.equal(mods.livingGenerations.count, 3);
  assert.equal(mods.livingGenerations.total, 3);
  assert.ok(!mods.livingGenerations.rows.flatMap((r) => r.ids).includes('d1'), 'the deceased great-grandparent is excluded');
});

test('livingGenerations: hides below the 3-living-generation threshold', () => {
  const people = [
    { id: 'p1', display_name: 'Parent', birth_date: '1955-01-01' },
    { id: 'c1', display_name: 'Child', birth_date: '1980-01-01' },
  ];
  const graph = buildGraph(people, [pRel('p1', 'c1')]);
  assert.equal(computeInsightModules(graph, 'c1').livingGenerations, null);
});

test('twinBirths: siblings sharing an exact birth date form a set; the Jan-1 placeholder never matches', () => {
  const people = [
    { id: 'p1', display_name: 'Mum', birth_date: '1950-01-01' },
    { id: 'a', display_name: 'Twin A', birth_date: '1975-06-15' },
    { id: 'b', display_name: 'Twin B', birth_date: '1975-06-15' },
    { id: 'c', display_name: 'Sibling C', birth_date: '1977-01-01' }, // year-only placeholder
    { id: 'd', display_name: 'Sibling D', birth_date: '1977-01-01' }, // same placeholder — must NOT count as twins
  ];
  const rels = [pRel('p1', 'a'), pRel('p1', 'b'), pRel('p1', 'c'), pRel('p1', 'd')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'a');
  assert.ok(mods.twinBirths, 'module should render for the real June 15th twins');
  assert.equal(mods.twinBirths.count, 1);
  assert.deepEqual(mods.twinBirths.sets[0].ids.sort(), ['a', 'b']);
  assert.equal(mods.twinBirths.sets[0].dateLabel, '15 June');
});

test('twinBirths: null when no siblings share an exact date', () => {
  const people = [
    { id: 'p1', display_name: 'Mum', birth_date: '1950-01-01' },
    { id: 'a', display_name: 'Kid A', birth_date: '1975-06-15' },
    { id: 'b', display_name: 'Kid B', birth_date: '1977-03-02' },
  ];
  const graph = buildGraph(people, [pRel('p1', 'a'), pRel('p1', 'b')]);
  assert.equal(computeInsightModules(graph, 'a').twinBirths, null);
});

test('earlyLoss: a single early death is already enough to render, sorted youngest first', () => {
  const people = [
    { id: 'a', display_name: 'Infant A', birth_date: '1900-01-01', death_date: '1900-06-01', is_deceased: true }, // < 1 yr
    { id: 'b', display_name: 'Child B', birth_date: '1910-01-01', death_date: '1925-01-01', is_deceased: true }, // 15
    { id: 'c', display_name: 'Adult C', birth_date: '1920-01-01', death_date: '1990-01-01', is_deceased: true }, // 70 — excluded
    { id: 'd', display_name: 'Living D', birth_date: '1990-01-01', is_deceased: false }, // living — excluded regardless of age
  ];
  const graph = buildGraph(people, []);
  const mods = computeInsightModules(graph, 'a');
  assert.ok(mods.earlyLoss, 'module should render even for a single early death');
  assert.equal(mods.earlyLoss.count, 2);
  assert.equal(mods.earlyLoss.youngest.id, 'a', 'the infant death leads — youngest first');
  assert.equal(mods.earlyLoss.youngest.age, 0);
  assert.deepEqual(mods.earlyLoss.list.map((x) => x.id), ['a', 'b']);
});

test('earlyLoss: null when no one in the tree died before 20', () => {
  const people = [
    { id: 'a', display_name: 'Adult A', birth_date: '1900-01-01', death_date: '1970-01-01', is_deceased: true },
  ];
  const graph = buildGraph(people, []);
  assert.equal(computeInsightModules(graph, 'a').earlyLoss, null);
});

test('centenarians: a single living centenarian is enough to render, age measured to `now`', () => {
  const now = new Date('2025-06-01').getTime();
  const people = [
    { id: 'a', display_name: 'Living Elder', birth_date: '1920-01-01', is_deceased: false }, // 105 as of `now`
    { id: 'b', display_name: 'Not Quite', birth_date: '1930-01-01', is_deceased: false }, // 95 — excluded
  ];
  const graph = buildGraph(people, []);
  const mods = computeInsightModules(graph, 'a', now);
  assert.ok(mods.centenarians, 'module should render for a single living centenarian');
  assert.equal(mods.centenarians.count, 1);
  assert.equal(mods.centenarians.oldest.id, 'a');
  assert.equal(mods.centenarians.oldest.age, 105);
  assert.equal(mods.centenarians.oldest.living, true);
});

test('centenarians: a deceased centenarian counts too, ranked oldest first alongside a living one', () => {
  const now = new Date('2025-06-01').getTime();
  const people = [
    { id: 'a', display_name: 'Deceased Elder', birth_date: '1900-01-01', death_date: '2005-01-01', is_deceased: true }, // 105
    { id: 'b', display_name: 'Living Elder', birth_date: '1922-01-01', is_deceased: false }, // 103
  ];
  const graph = buildGraph(people, []);
  const mods = computeInsightModules(graph, 'a', now);
  assert.equal(mods.centenarians.count, 2);
  assert.equal(mods.centenarians.oldest.id, 'a', 'the deceased 105-year-old outranks the living 103-year-old');
  assert.equal(mods.centenarians.list[1].id, 'b');
});

test('centenarians: null when no one has reached 100, and implausible ages (>130) are excluded as bad data', () => {
  const now = new Date('2025-06-01').getTime();
  const people = [
    { id: 'a', display_name: 'Not Quite', birth_date: '1930-01-01', is_deceased: false }, // 95
    { id: 'b', display_name: 'Bad Data', birth_date: '1800-01-01', is_deceased: false }, // 225 — implausible
  ];
  const graph = buildGraph(people, []);
  assert.equal(computeInsightModules(graph, 'a', now).centenarians, null);
});

test('newArrivals: living people born within the last 5 years of `now`, future-relative-to-now excluded', () => {
  const people = [
    { id: 'a', display_name: 'Baby A', birth_date: '2023-01-01' },
    { id: 'b', display_name: 'Baby B', birth_date: '2024-01-01' },
    { id: 'c', display_name: 'Older C', birth_date: '2010-01-01' }, // outside the 5-year window
    { id: 'd', display_name: 'Future D', birth_date: '2030-01-01' }, // born after `now` — must be excluded
  ];
  const now = new Date('2025-06-01').getTime();
  const graph = buildGraph(people, []);
  const mods = computeInsightModules(graph, 'a', now);
  assert.ok(mods.newArrivals, 'module should render with 2 recent arrivals');
  assert.equal(mods.newArrivals.count, 2);
  assert.deepEqual(mods.newArrivals.list.map((x) => x.id).sort(), ['a', 'b']);
});

test('newArrivals: a single recent birth stays below the 2-person threshold', () => {
  const people = [{ id: 'a', display_name: 'Baby A', birth_date: '2023-01-01' }];
  const graph = buildGraph(people, []);
  assert.equal(computeInsightModules(graph, 'a', new Date('2025-06-01').getTime()).newArrivals, null);
});

test('blendedFamily: counts step and adoptive bonds, hides below the 3-person threshold', () => {
  const people = [
    { id: 'p1', display_name: 'Parent', birth_date: '1960-01-01' },
    { id: 's1', display_name: 'Step Kid', birth_date: '1985-01-01' },
    { id: 'ad1', display_name: 'Adopted Kid', birth_date: '1986-01-01' },
    { id: 'ad2', display_name: 'Adopted Kid Two', birth_date: '1987-01-01' },
  ];
  const rels = [pRel('p1', 's1', 'step'), pRel('p1', 'ad1', 'adoptive'), pRel('p1', 'ad2', 'adoptive')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'p1');
  assert.ok(mods.blendedFamily, 'module should render with 3 people touched');
  assert.equal(mods.blendedFamily.stepCount, 1);
  assert.equal(mods.blendedFamily.adoptCount, 2);
  assert.equal(mods.blendedFamily.total, 3);

  const thin = buildGraph(
    [{ id: 'p2', display_name: 'Parent Two', birth_date: '1960-01-01' }, { id: 's2', display_name: 'Step Kid Two', birth_date: '1985-01-01' }],
    [pRel('p2', 's2', 'step')],
  );
  assert.equal(computeInsightModules(thin, 'p2').blendedFamily, null);
});

test('tradeLineage: an occupation shared 3+ generations down a direct parent line qualifies', () => {
  const people = [
    { id: 'g1', display_name: 'Grandparent', birth_date: '1900-01-01', occupation: 'Farmer' },
    { id: 'p1', display_name: 'Parent', birth_date: '1930-01-01', occupation: 'Farmer' },
    { id: 'c1', display_name: 'Child', birth_date: '1960-01-01', occupation: 'Farmer.' }, // punctuation variant — still merges
    { id: 'x1', display_name: 'Unrelated', birth_date: '1960-01-01', occupation: 'Teacher' },
  ];
  const rels = [pRel('g1', 'p1'), pRel('p1', 'c1')];
  const graph = buildGraph(people, rels);
  const mods = computeInsightModules(graph, 'c1');
  assert.ok(mods.tradeLineage, 'module should render for a 3-generation direct trade line');
  assert.equal(mods.tradeLineage.best.people.length, 3);
  assert.equal(mods.tradeLineage.best.occ, 'Farmer');
});

test('tradeLineage: a 2-generation match stays below the 3-generation threshold', () => {
  const people = [
    { id: 'p1', display_name: 'Parent', birth_date: '1930-01-01', occupation: 'Farmer' },
    { id: 'c1', display_name: 'Child', birth_date: '1960-01-01', occupation: 'Farmer' },
  ];
  const graph = buildGraph(people, [pRel('p1', 'c1')]);
  assert.equal(computeInsightModules(graph, 'c1').tradeLineage, null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
